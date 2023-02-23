import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';

export interface _SERVICE {
  'public_key' : ActorMethod<
    [],
    { 'Ok' : { 'public_key' : Uint8Array } } |
      { 'Err' : string }
  >,
  'set_client' : ActorMethod<
    [string, Array<string>],
    { 'Ok' : null } |
      { 'Err' : string }
  >,
  'sign_messages' : ActorMethod<
    [Uint8Array],
    { 'Ok' : { 'signature' : Uint8Array } } |
      { 'Err' : string }
  >,
  'sign_messages2' : ActorMethod<
    [Uint8Array, Uint8Array, Uint8Array, Uint8Array],
    { 'Ok' : Uint8Array } |
      { 'Err' : string }
  >,
  'test_beefy' : ActorMethod<
    [],
    { 'Ok' : { 'signature' : Uint8Array } } |
      { 'Err' : string }
  >,
  'test_beefy2' : ActorMethod<[], { 'Ok' : Uint8Array } | { 'Err' : string }>,
  'update_state' : ActorMethod<
    [Uint8Array],
    { 'Ok' : null } |
      { 'Err' : string }
  >,
}
