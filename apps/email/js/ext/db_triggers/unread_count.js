define(function () {
  'use strict';

  /**
   * This trigger listens to changes on conversations in order to adjust the
   * local unread conversation count for all folders.
   */
  return {
    name: 'unread_count',

    'conv!*!add': function (triggerModify, convInfo) {
      // Nothing to do if this conversation is already fully read.
      if (!convInfo.hasUnread) {
        return;
      }

      // Every folderId it belongs to gets an atomicDelta of 1.
      var folderDeltas = new Map();
      for (var folderId of convInfo.folderIds) {
        folderDeltas.set(folderId, {
          localUnreadConversations: 1
        });
      }
      triggerModify({
        atomicDeltas: {
          folders: folderDeltas
        }
      });
    },

    /**
     * Process changes to existing conversations including deletion.  The MailDB
     * does us a solid and has pre-computed changes to the folderId's by providing
     * added/kept/removed and these are correct even in the face of deletion.
     */
    'conv!*!change': function (triggerModify, convId, preInfo, convInfo, added, kept, removed) {
      var hasUnread = convInfo ? convInfo.hasUnread : false;

      // If the conversation was read before and is still read, then there are
      // no adjustments to make.
      if (!hasUnread && !preInfo.hasUnread) {
        return;
      }

      var folderDeltas = new Map();
      // Helper to populate folderDeltas based on the +1/-1 decisions below.
      var applyDelta = (folderIds, delta) => {
        for (var folderId of folderIds) {
          // We will see a given folderId at most once so we don't have to do any
          // math ourselves.
          folderDeltas.set(folderId, {
            localUnreadConversations: delta
          });
        }
      };

      if (hasUnread) {
        if (!preInfo.hasUnread) {
          // - The conversation is newly unread
          // The changes in folder id's don't matter, all that matters is now.
          // That's right, inspirational code comments.  You saw them here first.
          applyDelta(convInfo.folderIds, 1);
        } else {
          // - The conversation was already unread and is still unread
          // We just need to compensate for changes to the set of folder id's.
          applyDelta(added, 1);
          applyDelta(removed, -1);
        }
      } else {
        // (preInfo.hasUnread, because of the bail above.)
        // - The conversation is newly read.
        // We need to -1 all the previous folderId's.  We could get this off of
        // kept and removed, but it's more straightforward to just use the
        // preInfo.
        applyDelta(preInfo.folderIds, -1);
      }

      if (folderDeltas.size) {
        triggerModify({
          atomicDeltas: {
            folders: folderDeltas
          }
        });
      }
    }
  };
});
