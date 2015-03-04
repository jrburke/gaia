/*global MozActivity */
'use strict';
define(function (require) {
  var cards = require('cards'),
      ConfirmDialog = require('confirm_dialog'),
      fileDisplay = require('file_display'),
      iframeShims = require('iframe_shims'),
      MimeMapper = require('shared/js/mime_mapper'),
      mimeToClass = require('mime_to_class'),
      model = require('model'),
      mozL10n = require('l10n!'),
      msgAttachmentItemNode = require('tmpl!./msg/attachment_item.html'),
      msgBrowseConfirmNode = require('tmpl!./msg/browse_confirm.html'),
      queryURI = require('query_uri');

  var CONTENT_TYPES_TO_CLASS_NAMES = [
      null,
      'msg-body-content',
      'msg-body-signature',
      'msg-body-leadin',
      null,
      'msg-body-disclaimer',
      'msg-body-list',
      'msg-body-product',
      'msg-body-ads'
    ];
  var CONTENT_QUOTE_CLASS_NAMES = [
      'msg-body-q1',
      'msg-body-q2',
      'msg-body-q3',
      'msg-body-q4',
      'msg-body-q5',
      'msg-body-q6',
      'msg-body-q7',
      'msg-body-q8',
      'msg-body-q9'
    ];
  var MAX_QUOTE_CLASS_NAME = 'msg-body-qmax';

  // This function exists just to avoid lint errors around
  // "do not use 'new' for side effects.
  function sendActivity(obj) {
    return new MozActivity(obj);
  }

  return {
    createdCallback: function() {
      this.htmlBodyNodes = [];

      // whether or not we've built the body DOM the first time
      this._builtBodyDom = false;
    },

    /**
     * Render the DOM nodes for bodyReps and the attachments container.
     * If we have information on which parts of the message changed,
     * only update those DOM nodes; otherwise, update the whole thing.
     *
     * @param {object} changeDetails
     * @param {array} changeDetails.bodyReps An array of changed item indexes.
     * @param {array} changeDetails.attachments An array of changed item
     * indexes.
     */
    buildBodyDom: function(/* optional */ changeDetails) {
      var body = this.body;

      // If the card has been destroyed (so no more body, as it is nulled in
      // die()) or header has changed since this method was scheduled to be
      // called (rapid taps of the next/previous buttons), ingore the call.
      if (!body || this.header.id !== body.id) {
        return;
      }

      var domNode = this,
          rootBodyNode = this.rootBodyNode,
          reps = body.bodyReps,
          hasExternalImages = false,
          showEmbeddedImages = body.embeddedImageCount &&
                               body.embeddedImagesDownloaded;


      // The first time we build the body DOM, do one-time bootstrapping:
      if (!this._builtBodyDom) {
        iframeShims.bindSanitizedClickHandler(rootBodyNode,
                                              this.onHyperlinkClick.bind(this),
                                              rootBodyNode,
                                              null);
        this._builtBodyDom = true;
      }

      // If we have fully downloaded one body part, the user has
      // something to read so get rid of the spinner.
      // XXX: Potentially improve the UI to show if we're still
      // downloading the rest of the body even if we already have some
      // of it.
      if (reps.length && reps[0].isDownloaded) {
        // remove progress bar if we've retrieved the first rep
        var progressNode = rootBodyNode.querySelector('progress');
        if (progressNode) {
          progressNode.parentNode.removeChild(progressNode);
        }
      }

      // The logic below depends on having removed the progress node!

      for (var iRep = 0; iRep < reps.length; iRep++) {
        var rep = reps[iRep];

        // Create an element to hold this body rep. Even if we aren't
        // updating this rep right now, we need to have a placeholder.
        var repNode = rootBodyNode.children[iRep];
        if (!repNode) {
          repNode = rootBodyNode.appendChild(document.createElement('div'));
        }

        // Skip updating this rep if it's not updated.
        if (changeDetails && changeDetails.bodyReps &&
            changeDetails.bodyReps.indexOf(iRep) === -1) {
          continue;
        }

        // Wipe out the existing contents of the rep node so we can
        // replace it. We can just nuke innerHTML since we add click
        // handlers on the rootBodyNode, and for text/html parts the
        // listener is a child of repNode so it will get destroyed too.
        repNode.innerHTML = '';

        if (rep.type === 'plain') {
          this._populatePlaintextBodyNode(repNode, rep.content);
        }
        else if (rep.type === 'html') {
          var iframeShim = iframeShims.createAndInsertIframeForContent(
            rep.content, this.scrollContainer, repNode, null,
            'interactive', this.onHyperlinkClick.bind(this),
            this.onHeightChange);
          var iframe = iframeShim.iframe;
          var bodyNode = iframe.contentDocument.body;
          this.iframeResizeHandler = iframeShim.resizeHandler;
          model.api.utils.linkifyHTML(iframe.contentDocument);
          this.htmlBodyNodes.push(bodyNode);

          if (body.checkForExternalImages(bodyNode)) {
            hasExternalImages = true;
          }
          if (showEmbeddedImages) {
            body.showEmbeddedImages(bodyNode, this.iframeResizeHandler);
          }
        }
      }

      // The image logic checks embedded image counts, so this should be
      // able to run every time:
      // -- HTML-referenced Images
      var loadBar = this.loadBar;
      if (body.embeddedImageCount && !body.embeddedImagesDownloaded) {
        loadBar.classList.remove('collapsed');
        mozL10n.setAttributes(this.loadBarText, 'message-download-images-tap',
                              { n: body.embeddedImageCount });
      }
      else if (hasExternalImages) {
        loadBar.classList.remove('collapsed');
        mozL10n.setAttributes(this.loadBarText, 'message-show-external-images');
      }
      else {
        loadBar.classList.add('collapsed');
      }

      // -- Attachments (footer)
      // An attachment can be in 1 of 3 possible states for UI purposes:
      // - Not downloadable: We can't download this message because we wouldn't
      //   be able to do anything with it if we downloaded it.  Anything that's
      //   not a supported image type falls in this category.
      // - Downloadable, not downloaded: The user can trigger download of the
      //   attachment to DeviceStorage.
      // - Downloadable, downloaded: The attachment is already fully downloaded
      //   to DeviceStorage and we can trigger its display.
      var attachmentsContainer =
                            domNode.querySelector('.msg-attachments-container');
      if (body.attachments && body.attachments.length) {
        // If buildBodyDom is called multiple times, the attachment
        // state might change, so we must ensure the attachment list is
        // not collapsed if we now have attachments.
        attachmentsContainer.classList.remove('collapsed');

        var attTemplate = msgAttachmentItemNode,
            filenameTemplate =
              attTemplate.querySelector('.msg-attachment-filename'),
            filesizeTemplate =
              attTemplate.querySelector('.msg-attachment-filesize');
        for (var iAttach = 0; iAttach < body.attachments.length; iAttach++) {

          // Create an element to hold this attachment.
          var attNode = attachmentsContainer.children[iAttach];
          if (!attNode) {
            attNode = attachmentsContainer.appendChild(
              document.createElement('li'));
          }

          // Skip updating this attachment if it's not updated.
          if (changeDetails && changeDetails.attachments &&
              changeDetails.attachments.indexOf(iAttach) === -1) {
            continue;
          }

          var attachment = body.attachments[iAttach], state;
          var extension = attachment.filename.split('.').pop();

          var MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
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
          if (this.enableReply) {
            this.enableReply();
          }
        }
      }
      else {
        attachmentsContainer.classList.add('collapsed');
        if (this.enableReply) {
         this.enableReply();
        }
      }
    },

    _populatePlaintextBodyNode: function(bodyNode, rep) {
      for (var i = 0; i < rep.length; i += 2) {
        var node = document.createElement('div'), cname;

        var etype = rep[i] & 0xf;
        if (etype === 0x4) {
          var qdepth = (((rep[i] >> 8) & 0xff) + 1);
          if (qdepth > 8) {
            cname = MAX_QUOTE_CLASS_NAME;
          } else {
            cname = CONTENT_QUOTE_CLASS_NAMES[qdepth];
          }
        }
        else {
          cname = CONTENT_TYPES_TO_CLASS_NAMES[etype];
        }
        if (cname) {
          node.setAttribute('class', cname);
        }

        var subnodes = model.api.utils.linkifyPlain(rep[i + 1], document);
        for (var iNode = 0; iNode < subnodes.length; iNode++) {
          node.appendChild(subnodes[iNode]);
        }

        bodyNode.appendChild(node);
      }
    },

    handleBodyChange: function(evt) {
      this.buildBodyDom(evt.changeDetails);
    },


    onHyperlinkClick: function(event, linkNode, linkUrl, linkText) {
      var dialog = msgBrowseConfirmNode.cloneNode(true);
      var content = dialog.getElementsByTagName('p')[0];
      mozL10n.setAttributes(content, 'browse-to-url-prompt', { url: linkUrl });
      ConfirmDialog.show(dialog,
        { // Confirm
          id: 'msg-browse-ok',
          handler: function() {
            if (/^mailto:/i.test(linkUrl)) {
              // Fast path to compose. Works better than an activity, since
              // "canceling" the activity has freaky consequences: what does it
              // mean to cancel ourselves? What is the sound of one hand
              // clapping?
              var data = queryURI(linkUrl);
              cards.pushCard('compose', 'animate', {
                composerData: {
                  onComposer: function(composer, composeCard) {
                    // Copy the to, cc, bcc, subject, body to the compose.
                    // It is OK to do this blind key copy since queryURI
                    // explicitly only populates expected fields, does not
                    // blindly accept input from the outside, and the queryURI
                    // properties match the property names allowed on composer.
                    Object.keys(data).forEach(function(key) {
                      composer[key] = data[key];
                    });
                  }
                }
              });
            } else {
              // Pop out to what is likely the browser, or the user's preferred
              // viewer for the URL. This keeps the URL out of our cookie
              // jar/data space too.
              sendActivity({
                name: 'view',
                data: {
                  type: 'url',
                  url: linkUrl
                }
              });
            }
          }.bind(this)
        },
        { // Cancel
          id: 'msg-browse-cancel',
          handler: null
        }
      );
    },

    onLoadBarClick: function(event) {
      var self = this;
      var loadBar = this.loadBar;
      if (!this.body.embeddedImagesDownloaded) {
        this.body.downloadEmbeddedImages(function() {
          // this gets nulled out when we get killed, so use this to bail.
          // XXX of course, this closure will cause us to potentially hold onto
          // a lot of garbage, so it would be better to add an
          // 'onimagesdownloaded' to body so that the closure would end up as
          // part of a cycle that would get collected.
          if (!self.body) {
            return;
          }

          for (var i = 0; i < self.htmlBodyNodes.length; i++) {
            self.body.showEmbeddedImages(self.htmlBodyNodes[i],
                                         self.iframeResizeHandler);
          }
        });
        // XXX really we should check for external images to display that load
        // bar, although it's a bit silly to have both in a single e-mail.
        loadBar.classList.add('collapsed');
      }
      else {
        for (var i = 0; i < this.htmlBodyNodes.length; i++) {
          this.body.showExternalImages(this.htmlBodyNodes[i],
                                       this.iframeResizeHandler);
        }
        loadBar.classList.add('collapsed');
      }
    },
  };
});
