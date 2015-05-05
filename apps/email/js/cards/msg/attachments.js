/*global MozActivity */
'use strict';

define(function(require, exports) {

var ConfirmDialog = require('confirm_dialog'),
    MimeMapper = require('shared/js/mime_mapper'),
    fileDisplay = require('file_display'),
    mimeToClass = require('mime_to_class'),
    msgAttachmentDidNotOpenAlertNode =
      require('tmpl!./attachment_did_not_open_alert.html'),
    msgAttachmentItemNode = require('tmpl!./attachment_item.html');


var OCTET_STREAM_TYPE = 'application/octet-stream';

return [
  require('../base')(require('template!./attachments.html')),
  {
    clear: function() {
      this.querySelector('.msg-attachments-container').innerHTML = '';
      this.attachmentsContainer.classList.add('collapsed');
    },

    setAttachments: function(attachments, changeDetails) {
      var attachmentsContainer = this.attachmentsContainer;

      // -- Attachments (footer)
      // An attachment can be in 1 of 3 possible states for UI purposes:
      // - Not downloadable: We can't download this message because we wouldn't
      //   be able to do anything with it if we downloaded it.  Anything that's
      //   not a supported image type falls in this category.
      // - Downloadable, not downloaded: The user can trigger download of the
      //   attachment to DeviceStorage.
      // - Downloadable, downloaded: The attachment is already fully downloaded
      //   to DeviceStorage and we can trigger its display.
      if (attachments && attachments.length) {
        // If buildBodyDom is called multiple times, the attachment
        // state might change, so we must ensure the attachment list is
        // not collapsed if we now have attachments.
        attachmentsContainer.classList.remove('collapsed');

        var attTemplate = msgAttachmentItemNode,
            filenameTemplate =
              attTemplate.querySelector('.msg-attachment-filename'),
            filesizeTemplate =
              attTemplate.querySelector('.msg-attachment-filesize');

        for (var iAttach = 0; iAttach < attachments.length; iAttach++) {
          // Create an element to hold this attachment.
          var attNode = attachmentsContainer.childNodes[iAttach];
          if (!attNode) {
            attNode = attachmentsContainer.appendChild(
              document.createElement('li'));
          }

          // Skip updating this attachment if it's not updated.
          if (changeDetails && changeDetails.attachments &&
              changeDetails.attachments.indexOf(iAttach) === -1) {
            continue;
          }

          var attachment = attachments[iAttach], state;
          var extension = attachment.filename.split('.').pop();

          // Keeping in-sync with the compose.js value of 22 now, plus some
          // slop to deal with encoding and just be fine with the general
          // provider upper bound of 25.
          var MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
          var attachmentDownloadable = true;
          var mimeClass = mimeToClass(attachment.mimetype ||
                          MimeMapper.guessTypeFromExtension(extension));

          if (attachment.isDownloaded) {
            state = 'downloaded';
          } else if (!attachment.isDownloadable) {
            state = 'nodownload';
            attachmentDownloadable = false;
          } else if (attachment.sizeEstimateInBytes > MAX_ATTACHMENT_SIZE) {
            state = 'toolarge';
            attachmentDownloadable = false;
          } else {
            state = 'downloadable';
          }
          attTemplate.setAttribute('state', state);
          filenameTemplate.textContent = attachment.filename;
          fileDisplay.fileSize(filesizeTemplate,
                               attachment.sizeEstimateInBytes);

          var attachmentNode = attTemplate.cloneNode(true);
          attachmentNode.classList.add(mimeClass);
          attachmentsContainer.replaceChild(attachmentNode, attNode);

          var downloadButton = attachmentNode.querySelector(
                               '.msg-attachment-download');
          downloadButton.disabled = !attachmentDownloadable;
          if (attachmentDownloadable) {
            downloadButton.addEventListener(
              'click', this.onDownloadAttachmentClick.bind(
                this, attachmentNode, attachment));
          }
          attachmentNode.setAttribute('aria-disabled',
            !attachmentDownloadable);
          attachmentNode.querySelector('.msg-attachment-view')
            .addEventListener('click',
                              this.onViewAttachmentClick.bind(
                                this, attachmentNode, attachment));
        }
      } else {
        attachmentsContainer.classList.add('collapsed');
      }
    },

    onDownloadAttachmentClick: function(node, attachment) {
      node.setAttribute('state', 'downloading');
      // We register all downloads with the download manager.  Previously we had
      // thought about only registering non-media types because the media types
      // were already covered by built-in apps.  But we didn't have a good
      // reason for that; perhaps risk avoidance?  So everybody gets logged!
      // Note that POP3 also does this, but that happens in pop3/sync.js in
      // the back-end and the front-end has no control over that.
      var registerWithDownloadManager = true;
      attachment.download(function downloaded() {
        if (!attachment._file) {
          return;
        }

        node.setAttribute('state', 'downloaded');
      }, null, registerWithDownloadManager);
    },

    onViewAttachmentClick: function(node, attachment) {
      console.log('trying to open', attachment._file, 'known type:',
                  attachment.mimetype);
      if (!attachment._file) {
        return;
      }

      if (attachment.isDownloaded) {
        this.getAttachmentBlob(attachment, function(blob) {
          try {
            // Now that we have the file, use an activity to open it
            if (!blob) {
              throw new Error('Blob does not exist');
            }

            // - Figure out the best MIME type
            //
            // We have three MIME type databases at our disposal:
            //
            // - mimetypes(.js): A reasonably comprehensive database but that's
            //   not continually updated and potentially is out-of-date about
            //   some audio and video types.
            //
            // - nsIMIMEService via DeviceStorage.  Anything that was stored
            //   in DeviceStorage will have its MIME type looked-up using
            //   nsIMIMEService which in turn checks a short hard-coded list
            //   (mainly containing the core web video/audio/doc types),
            //   preferences, the OS, extensions, plugins, category manager
            //   stuff, and then a slightly longer list of hard-coded entries.
            //
            // - shared/js/mime_mapper.js: It knows about all of the media types
            //   supported by Gecko and our media apps.  It at least has
            //   historically been updated pretty promptly.
            //
            //
            // For IMAP and POP3, we get the MIME type from the composer of the
            // message.  They explicitly include a MIME type.  Assuming the
            // author of the message also created the attachment, there's a very
            // high probability they included a valid MIME type (based on a
            // local file extension mapping).  If the author forwarded a message
            // with the attachment maintained, there's also a good chance the
            // MIME type was maintained.  If the author downloaded the
            // attachment but lacked a mapping for the file extension, the
            // reported MIME type is probably application/octet-stream.  As
            // of writing this, our IMAP and POP3 implementations do not
            // second-guess the reported MIME type if it is
            // application/octet-stream.
            //
            // In the ActiveSync case, we are not given any MIME type
            // information and our ActiveSync library uses mimetypes.js to
            // map the extension type.  This may result in
            // application/octet-stream being returned.
            //
            // Given all of this, our process for determining MIME types is to:
            // - Trust the MIME type we have on file for the message if it's
            //   anything other than application/octet-stream.
            var useType = attachment.mimetype;
            // - If it was octet-stream (or somehow missing), we check if
            //   DeviceStorage has an opinion.  We use it if so.
            if (!useType || useType === OCTET_STREAM_TYPE) {
              useType = blob.type;
            }
            // - If we still think it's octet-stream (or falsey), we ask the
            //   MimeMapper to map the file extension to a MIME type.
            if (!useType || useType === OCTET_STREAM_TYPE) {
              useType = MimeMapper.guessTypeFromFileProperties(
                          attachment.filename, OCTET_STREAM_TYPE);
            }
            // - If it's falsey (MimeMapper returns an emptry string if it
            //   can't map), we set the value to application/octet-stream.
            if (!useType) {
              useType = OCTET_STREAM_TYPE;
            }
            // - At this point, we're fine with application/octet-stream.
            //   Although there are some file-types where we can just chuck
            //   "application/" on the front, there aren't enough of them.
            //   Apps can, however, use a regexp filter on the filename we
            //   provide to capture extension types that way.
            console.log('triggering open activity with MIME type:', useType);

            var activity = new MozActivity({
              name: 'open',
              data: {
                type: useType,
                filename: attachment.filename,
                blob: blob,
                // the PDF viewer really wants a "url".  download_helper.js
                // provides the local filesystem path which is sketchy and
                // non-sensical.  We just provide the filename again.
                url: attachment.filename
              }
            });
            activity.onerror = function() {
              console.warn('Problem with "open" activity', activity.error.name);
              // NO_PROVIDER is returned if there's nothing to service the
              // activity.
              if (activity.error.name === 'NO_PROVIDER') {
                var dialog = msgAttachmentDidNotOpenAlertNode.cloneNode(true);
                ConfirmDialog.show(dialog,
                  {
                    id: 'msg-attachment-did-not-open-ok',
                    handler: null
                  },
                  {
                    handler: null
                  }
                );
              }
            };
            activity.onsuccess = function() {
              console.log('"open" activity allegedly succeeded');
            };
          }
          catch (ex) {
            console.warn('Problem creating "open" activity:', ex, '\n',
                         ex.stack);
          }
        });
      }
    },

    getAttachmentBlob: function(attachment, callback) {
      try {
        // Get the file contents as a blob, so we can open the blob
        var storageType = attachment._file[0];
        var filename = attachment._file[1];
        var storage = navigator.getDeviceStorage(storageType);
        var getreq = storage.get(filename);

        getreq.onerror = function() {
          console.warn('Could not open attachment file: ', filename,
                       getreq.error.name);
        };

        getreq.onsuccess = function() {
          // Now that we have the file, return the blob within callback function
          var blob = getreq.result;
          callback(blob);
        };
      } catch (ex) {
        console.warn('Exception getting attachment from device storage:',
                     attachment._file, '\n', ex, '\n', ex.stack);
      }
    }
  }
];

});
