export type DatabaseSchema = {
  subscriber: Subscriber
  post: Post
  follow: Follow
  sub_state: SubState
}

export type Post = {
  uri: string
  indexedBy: string
  indexedAt: string
}

export type Subscriber = {
  did: string
}

export type Follow = {
  uri: string
  author: string
  followee: string  
}

export type SubState = {
  service: string
  cursor: number
}
