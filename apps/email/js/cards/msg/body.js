/*global MozActivity */
'use strict';

define(function(require, exports) {

var cards = require('cards'),
    ConfirmDialog = require('confirm_dialog'),
    iframeShims = require('iframe_shims'),
    mozL10n = require('l10n!'),
    msgBrowseConfirmNode = require('tmpl!./browse_confirm.html'),
    queryURI = require('query_uri'),
    xfetch = require('xfetch');

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

return [
  require('../base')(require('template!./body.html')),
  require('../mixins/dom_evt'),
  {
    createdCallback: function() {
      // The body elements for the (potentially multiple) iframes we created to
      // hold HTML email content.
      this.htmlBodyNodes = [];

      // whether or not we've built the body DOM the first time
      this._builtBodyDom = false;
    },

    clear: function() {
      // Bail if internals not set up for first render.
      if (!this.rootBodyNode) {
        return;
      }

      // Nuke existing body, show progress while waiting
      // for message to load.
      this.rootBodyNode.innerHTML =
        '<progress data-l10n-id="message-body-container-progress"></progress>';

      // Make sure load bar is not shown between loads too.
      this.loadBar.classList.add('collapsed');
    },

    handleBodyChange: function() {
      this.buildBodyDom();
    },

    setState: function (model, message) {
      // Clean up any events on the old message.
      if (this.message) {
        this.message.removeObjectListener(this);
      }

      this.model = model;
      this.message = message;

      if (message.bodyRepsDownloaded) {
console.log('msg/body bodyRepsDownloaded, so going to buildBodyDom');
        this.buildBodyDom();
      } else {
console.log('msg/body CALLING downloadBodyReps');
        message.on('change', this, 'handleBodyChange');
        message.downloadBodyReps();
      }
    },

    buildBodyDom: function() {
      var message = this.message;

      var rootBodyNode = this.rootBodyNode,
          reps = message.bodyReps;


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

      rootBodyNode.innerHTML = '';
      reps.forEach((rep) => {
        // Create an element to hold this body rep.
        var repNode = rootBodyNode.appendChild(document.createElement('div'));

        if (rep.type === 'plain') {
          var blobUrl = URL.createObjectURL(rep.contentBlob);
          xfetch(blobUrl, 'json').then((rep) => {
            URL.revokeObjectURL(blobUrl);
            this._populatePlaintextBodyNode(repNode, rep);
          }, function(err) {
            console.error('Fetching text content from blob failed: ' + err);
            URL.revokeObjectURL(blobUrl);
          });
        } else if (rep.type === 'html') {
          this.displayBlobHtml(rep, repNode);
        }
      });

      this.dispatchEvent(new CustomEvent('bodyChanged', {
        detail: {
          message: this.message
        }
      }));
    },

    displayBlobHtml: function(rep, repNode) {
      // If no scrollContainer set yet, default is the parentNode as the
      // scrollContainer.
      if (!this.scrollContainer) {
        this.scrollContainer = this.parentNode;
      }

      iframeShims.createAndInsertIframeForContent(
        rep.contentBlob, this.scrollContainer, repNode, null,
        'interactive', this.onHyperlinkClick.bind(this))
      .then((iframeShim) => {
        var message = this.message;
        var iframe = iframeShim.iframe;
        var bodyNode = iframe.contentDocument.body;
        this.iframeResizeHandler = iframeShim.resizeHandler;
        this.model.api.utils.linkifyHTML(iframe.contentDocument);
        this.htmlBodyNodes.push(bodyNode);

        var hasExternalImages = false,
            showEmbeddedImages = message.embeddedImageCount &&
                                 message.embeddedImagesDownloaded;

        if (message.checkForExternalImages(bodyNode)) {
          hasExternalImages = true;
        }
        if (showEmbeddedImages) {
          message.showEmbeddedImages(bodyNode, this.iframeResizeHandler);
        }

        // The image logic checks embedded image counts, so this should be
        // able to run every time:
        // -- HTML-referenced Images
        var loadBar = this.loadBar;
        if (message.embeddedImageCount && !message.embeddedImagesDownloaded) {
          loadBar.classList.remove('collapsed');
          mozL10n.setAttributes(this.loadBarText, 'message-download-images-tap',
                                { n: message.embeddedImageCount });
        } else if (hasExternalImages) {
          loadBar.classList.remove('collapsed');
          mozL10n.setAttributes(this.loadBarText,
                                'message-show-external-images');
        } else {
          loadBar.classList.add('collapsed');
        }
      });
    },

    onHyperlinkClick: function(event, linkNode, linkUrl, linkText) {
      if (/^mailto:/i.test(linkUrl)) {
        // Fast path to compose. Works better than an activity, since
        // "canceling" the activity has freaky consequences: what does it
        // mean to cancel ourselves? What is the sound of one hand
        // clapping?
        var data = queryURI(linkUrl);
        cards.pushCard('compose', 'animate', {
          model: this.model,
          composerData: {
            onComposer: (composer, composeCard) => {
              // Copy the to, cc, bcc, subject, body to the compose.
              // It is OK to do this blind key copy since queryURI
              // explicitly only populates expected fields, does not
              // blindly accept input from the outside, and the queryURI
              // properties match the property names allowed on composer.
              Object.keys(data).forEach((key) => {
                if (key === 'to' || key === 'cc' || key === 'bcc') {
                  composer[key] = data[key].map((addr) => {
                    return this.model.api.parseMailbox(addr).address;
                  }).filter(function(value) {
                    // Filter out nulls if address parsing failed.
                    return value;
                  });
                } else {
                  composer[key] = data[key];
                }
              });
            }
          }
        });
      } else {
        var dialog = msgBrowseConfirmNode.cloneNode(true);
        var content = dialog.getElementsByTagName('p')[0];
        mozL10n.setAttributes(content, 'browse-to-url-prompt',
          { url: linkUrl });
        ConfirmDialog.show(dialog,
          { // Confirm
            id: 'msg-browse-ok',
            handler: function() {
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
            }.bind(this)
          },
          { // Cancel
            id: 'msg-browse-cancel',
            handler: null
          }
        );
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

        var subnodes = this.model.api.utils.linkifyPlain(rep[i + 1], document);
        for (var iNode = 0; iNode < subnodes.length; iNode++) {
          node.appendChild(subnodes[iNode]);
        }

        bodyNode.appendChild(node);
      }
    },

    onLoadBarClick: function(event) {
      var self = this;
      var loadBar = this.loadBar;
      if (!this.message.embeddedImagesDownloaded) {
        this.message.downloadEmbeddedImages(function() {
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
          this.message.showExternalImages(this.htmlBodyNodes[i],
                                          this.iframeResizeHandler);
        }
        loadBar.classList.add('collapsed');
      }
    },

    release: function() {
      if (this.message) {
        this.message.removeObjectListener(this);
        this.message = null;
      }
    }
  }
];

});
