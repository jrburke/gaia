define(function (require) {
  'use strict';

  const TaskDefiner = require('../../task_infra/task_definer');

  /**
   * POP3's custom logic is to:
   * - move the message into the (local-only) sent folder
   * - lose the attachments.
   *
   * TODO: in the future when the attachments use the download cache we can keep
   * them around.
   */
  return TaskDefiner.defineComplexTask([require('../../task_mixins/mix_outbox_send'), {
    shouldIncludeBcc: function () /*account*/{
      // Never trust the SMTP server to not screw up since by definition a POP3
      // server is part of a horrible mail server configuration.
      return false;
    },

    /**
     * We move the message to the sent folder, updating the representation so
     * that the attachment blobs are stripped and their MIME types updated to
     * our magic value that MailAttachment knows to say means they cannot be
     * downloaded.
     */
    saveSentMessage: function ({ messageInfo, account }) {
      // Put it in the sent folder.
      var sentFolder = account.getFirstFolderWithType('sent');
      messageInfo.folderIds = [sentFolder.id];

      // Mark the message as read.  We are clobbering other flags, but we don't
      // currently support a way for them to exist.
      attachment.flags = ['\\Seen'];
      for (var _attachment of messageInfo.attachments) {
        _attachment.type = 'application/x-gelam-no-download';
        // bye-bye Blob!
        _attachment.file = null;
      }
    }
  }]);
});
