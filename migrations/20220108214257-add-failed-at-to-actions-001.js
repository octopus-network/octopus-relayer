'use strict';

exports.up = function(db) {
  return db.addColumn('actions', 'failed_at', { type: 'integer' },
    () => console.log("Done!"));
};

exports.down = function(db) {
  // return db.removeColumn('actions', 'failed_at',
  //   () => console.log("failed_at has been removed from actions!")
  // );
};

exports._meta = {
  "version": 1
};
