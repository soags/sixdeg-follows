import { DeleteResult } from 'kysely'
import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'

// 購読者をキャッシュする
const cache = {}

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return
    const ops = await getOpsByType(evt)

    // 購読者をDB or キャッシュから取得
    const nowTime = Date.now()
    if (!cache['db'] || !cache['time'] || nowTime - cache['time'] > 10 * 1000) {
      console.log('⌛subscribersDB set', nowTime)
      cache['time'] = nowTime
      cache['db'] = await this.db.selectFrom('subscriber').selectAll().execute()
    }
    const subscribers = cache['db'].map((subsc) => subsc.did)

    // Unfollowは素直に削除
    const followsToDelete = ops.follows.deletes.map((follow) => follow.uri)
    if (followsToDelete.length > 0) {
      const res = await this.db
        .deleteFrom('follow')
        .where('uri', 'in', followsToDelete)
        .execute()
      const deletedRows = this.totalDeleteRows(res)
      if (deletedRows > 0) {
        console.log('Delete follow:', deletedRows)
      }
    }

    // Unlikeは影響したPostを削除
    const likesToDelete = ops.likes.deletes.map((like) => like.uri)
    if (likesToDelete.length > 0) {
      const res = await this.db
        .deleteFrom('post')
        .where('indexedBy', 'in', likesToDelete)
        .execute()
      const deletedRows = this.totalDeleteRows(res)
      if (deletedRows > 0) {
        console.log('Delete post by unlike:', deletedRows)
      }
    }

    // Unrepostは影響したPostを削除
    const repostsToDelete = ops.reposts.deletes.map((repost) => repost.uri)
    if (repostsToDelete.length > 0) {
      const res = await this.db
        .deleteFrom('post')
        .where('indexedBy', 'in', repostsToDelete)
        .execute()
      const deletedRows = this.totalDeleteRows(res)
      if (deletedRows > 0) {
        console.log('Delete post by unrepost:', deletedRows)
      }
    }

    // 購読者のFollowを保存
    const subscribersFollows = ops.follows.creates
      .filter((follow) => subscribers.includes(follow.author))
      .map((follow) => {
        return {
          uri: follow.uri,
          author: follow.author,
          followee: follow.record.subject,
        }
      })
    for (const follow of subscribersFollows) {
      console.log('Follow', follow.author, 'to', follow.followee)
    }
    if (subscribersFollows.length > 0) {
      await this.db
        .insertInto('follow')
        .values(subscribersFollows)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }

    // フォロイーを取得
    const followees = (
      await this.db.selectFrom('follow').selectAll().execute()
    ).map((follow) => follow.followee)

    // フォロイーがLikeしたPostを保存
    const followeesLikes = ops.likes.creates
      .filter((like) => followees.includes(like.author))
      .map((like) => {
        return {
          uri: like.record.subject.uri,
          indexedBy: like.uri,
          indexedAt: new Date().toISOString(),
        }
      })
    if (followeesLikes.length > 0) {
      await this.db
        .insertInto('post')
        .values(followeesLikes)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }

    // フォロイーがRepostしたPostをDBに保存
    const followeesReposts = ops.reposts.creates
      .filter((repost) => followees.includes(repost.author))
      .map((repost) => {
        return {
          uri: repost.record.subject.uri,
          indexedBy: repost.uri,
          indexedAt: new Date().toISOString(),
        }
      })
    if (followeesReposts.length > 0) {
      await this.db
        .insertInto('post')
        .values(followeesReposts)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }

  totalDeleteRows(result: DeleteResult[]) {
    return result.reduce((prev, curr) => prev + curr.numDeletedRows, BigInt(0))
  }
}
