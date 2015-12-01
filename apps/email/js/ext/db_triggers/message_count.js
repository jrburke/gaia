define(function () {
  'use strict';

  /**
   * We maintain a tally of known messages (locally) in each folder.  See the
   * `FolderMeta` defition in folder_info_rep.js for more information.
   */
  return {
    name: 'message_count',

    'msg!*!add': function (triggerModify, message) {
      // Every folderId it belongs to gets an atomicDelta of 1.
      var folderDeltas = new Map();
      for (var folderId of message.folderIds) {
        folderDeltas.set(folderId, {
          localMessageCount: 1
        });
      }
      triggerModify({
        atomicDeltas: {
          folders: folderDeltas
        }
      });
    },

    'msg!*!change': function (triggerModify, messageId, preInfo, message, added, kept, removed) {
      if (!added.size && !removed.size) {
        return;
      }

      var folderDeltas = new Map();
      for (var folderId of added) {
        folderDeltas.set(folderId, {
          localMessageCount: 1
        });
      }
      for (var folderId of removed) {
        folderDeltas.set(folderId, {
          localMessageCount: -1
        });
      }

      triggerModify({
        atomicDeltas: {
          folders: folderDeltas
        }
      });
    }
  };
});
