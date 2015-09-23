define(function (require) {
  'use strict';

  var co = require('co');

  var TaskDefiner = require('../../task_infra/task_definer');

  return TaskDefiner.defineComplexTask([require('./mix_sync_body'), {
    prepForMessages: co.wrap(function* (ctx, account, messages) {
      var umidLocations = new Map();
      for (var message of messages) {
        umidLocations.set(message.umid, null);
      }

      // We need to look up all the umidLocations.
      yield ctx.read({
        umidLocations
      });

      return umidLocations;
    }),

    getFolderAndUidForMesssage: function (umidLocations, account, message) {
      var [folderId, uid] = umidLocations.get(message.umid);
      return {
        folderInfo: account.getFolderById(folderId),
        uid
      };
    }
  }]);
});
