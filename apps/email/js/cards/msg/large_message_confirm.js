'use strict';

define(function(require, exports) {

var ConfirmDialog = require('confirm_dialog'),
    largeMsgConfirmMsgNode = require('tmpl!./large_message_confirm.html');

// This number is somewhat arbitrary, based on a guess that most
// plain-text/HTML messages will be smaller than this. If this
// value is too small, users get warned unnecessarily. Too large
// and they download a lot of data without knowing. Since we
// currently assume that all network connections are metered,
// they'll always see this if they get a large message...
var LARGE_MESSAGE_SIZE = 1 * 1024 * 1024;

/**
 * Show a warning that the given message is large.
 * Callback is called with cb(true|false) to continue.
 */
function showLargeMessageWarning(size, cb) {
  var dialog = largeMsgConfirmMsgNode.cloneNode(true);
  // TODO: If UX designers want the size included in the warning
  // message, add it here.
  ConfirmDialog.show(dialog,
    { // Confirm
      id: 'msg-large-message-ok',
      handler: function() { cb(true); }
    },
    { // Cancel
      id: 'msg-large-message-cancel',
      handler: function() { cb(false); }
    }
  );
}

/**
 * Checks if the message is too large, and asks the user if they want to
 * download it. If so, promise is resolved, if canceled, promise is rejected.
 * @param  {MailMessage} message
 * @return {Promise}
 */
return function largeMessageConfirm(message) {
  // Watch out, header might be undefined here if user triggers UI action before
  // the full data model is loaded.
  return new Promise(function(resolve, reject) {
    if (message && message.bytesToDownloadForBodyDisplay > LARGE_MESSAGE_SIZE) {
      showLargeMessageWarning(
        message.bytesToDownloadForBodyDisplay, function(result) {
        if (result) {
          resolve();
        } else {
          reject();
        }
      });
    } else {
      resolve();
    }
  });
};

});
