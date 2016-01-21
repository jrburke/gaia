define(function(require) {
'use strict';

let { numericUidFromMessageId } = require('../../id_conversions');

let TaskDefiner = require('../../task_definer');

return TaskDefiner.defineComplexTask([
  require('../vanilla_tasks/mix_sync_body'),
  {
    prepForMessages: function(ctx, account/*, messages*/) {
      // For the gmail case we don't have any meaningful prep to do.
      let allMailFolderInfo = account.getFirstFolderWithType('all');
      return Promise.resolve(allMailFolderInfo);
    },

    getFolderAndUidForMesssage: function(prepped, account, message) {
      return {
        folderInfo: prepped,
        uid: numericUidFromMessageId(message.id)
      };
    }
  }
]);
});
