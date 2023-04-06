// @ts-nocheck
export const idlFactory = ({ IDL }) => {
  return IDL.Service({
    'public_key' : IDL.Func(
        [],
        [
          IDL.Variant({
            'Ok' : IDL.Record({ 'public_key' : IDL.Vec(IDL.Nat8) }),
            'Err' : IDL.Text,
          }),
        ],
        [],
      ),
    'reset_client' : IDL.Func(
        [IDL.Text, IDL.Vec(IDL.Text)],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'set_client' : IDL.Func(
        [IDL.Text, IDL.Vec(IDL.Text)],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
    'sign_messages' : IDL.Func(
        [
          IDL.Vec(IDL.Nat8),
          IDL.Vec(IDL.Nat8),
          IDL.Vec(IDL.Nat8),
          IDL.Vec(IDL.Nat8),
        ],
        [IDL.Variant({ 'Ok' : IDL.Vec(IDL.Nat8), 'Err' : IDL.Text })],
        [],
      ),
    'update_state' : IDL.Func(
        [
          IDL.Vec(IDL.Nat8),
          IDL.Vec(IDL.Vec(IDL.Nat8)),
          IDL.Vec(IDL.Nat8),
          IDL.Vec(IDL.Nat8),
        ],
        [IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text })],
        [],
      ),
  });
};
export const init = ({ IDL }) => { return []; };