/*global define, console, window, navigator, document, MozActivity */
define([
  'tmpl!./message-reader.html',
  'tmpl!./msg/delete-confirm.html',
  'tmpl!./msg/contact-menu.html',
  'tmpl!./msg/browse-confirm.html',
  'tmpl!./msg/peep-bubble.html',
  'tmpl!./msg/attachment-item.html',
  'mail-common',
  'require',
  'api',
  'iframe-shims',
  'contacts',
  'l10n',
  'css!style/message-cards'
], function (templateNode, msgDeleteConfirmNode, msgContactMenuNode,
             msgBrowseConfirmNode, msgPeepBubbleNode, msgAttachmentItemNode,
             common, require, MailAPI, iframeShims, ContactDataManager,
             mozL10n) {

console.log('MESSAGE CARD GOT: ' + MailAPI);

var MimeMapper,
    Cards = common.Cards,
    Toaster = common.Toaster,
    ConfirmDialog = common.ConfirmDialog,
    displaySubject = common.displaySubject,
    prettyDate = common.prettyDate,
    prettyFileSize = common.prettyFileSize;

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

function MessageReaderCard(domNode, mode, args) {
  this.domNode = domNode;
  this.header = args.header;
  // The body elements for the (potentially multiple) iframes we created to hold
  // HTML email content.
  this.htmlBodyNodes = [];

  domNode.getElementsByClassName('msg-back-btn')[0]
    .addEventListener('click', this.onBack.bind(this, false));
  domNode.getElementsByClassName('msg-reply-btn')[0]
    .addEventListener('click', this.onReply.bind(this, false));
  domNode.getElementsByClassName('msg-reply-all-btn')[0]
    .addEventListener('click', this.onReplyAll.bind(this, false));

  domNode.getElementsByClassName('msg-delete-btn')[0]
    .addEventListener('click', this.onDelete.bind(this), false);
  domNode.getElementsByClassName('msg-star-btn')[0]
    .addEventListener('click', this.onToggleStar.bind(this), false);
  domNode.getElementsByClassName('msg-move-btn')[0]
    .addEventListener('click', this.onMove.bind(this), false);
  domNode.getElementsByClassName('msg-forward-btn')[0]
    .addEventListener('click', this.onForward.bind(this), false);

  this.scrollContainer =
    domNode.getElementsByClassName('scrollregion-below-header')[0];

  this.envelopeNode = domNode.getElementsByClassName('msg-envelope-bar')[0];
  this.envelopeNode
    .addEventListener('click', this.onEnvelopeClick.bind(this), false);

  this.envelopeDetailsNode =
    domNode.getElementsByClassName('msg-envelope-details')[0];

  domNode.getElementsByClassName('msg-reader-load-infobar')[0]
    .addEventListener('click', this.onLoadBarClick.bind(this), false);

  // - mark message read (if it is not already)
  if (!this.header.isRead)
    this.header.setRead(true);

  if (this.header.isStarred)
    domNode.getElementsByClassName('msg-star-btn')[0].classList
           .add('msg-btn-active');

  // event handler for body change events...
  this.handleBodyChange = this.handleBodyChange.bind(this);

}
MessageReaderCard.prototype = {
  _contextMenuType: {
    VIEW_CONTACT: 1,
    CREATE_CONTACT: 2,
    ADD_TO_CONTACT: 4,
    REPLY: 8,
    NEW_MESSAGE: 16
  },

  postInsert: function() {
    // iframes need to be linked into the DOM tree before their contentDocument
    // can be instantiated.
    this.buildBodyDom(this.domNode);

    var self = this;
    this.header.getBody({ downloadBodyReps: true }, function(body) {
      self.body = body;

      // always attach the change listener.
      body.onchange = self.handleBodyChange;

      // if the body reps are downloaded show the message immediately.
      if (body.bodyRepsDownloaded) {
        self.buildBodyDom();
        });
      }

      // XXX trigger spinner
      //
    });
  },

  handleBodyChange: function(evt) {
    switch (evt.changeType) {
      case 'bodyReps':
        if (this.body.bodyRepsDownloaded) {
          this.buildBodyDom();
        }
        break;
    }
  },

  onBack: function(event) {
    Cards.removeCardAndSuccessors(this.domNode, 'animate');
  },

  onReply: function(event) {
    Cards.eatEventsUntilNextCard();
    var composer = this.header.replyToMessage(null, function() {
      Cards.pushCard('compose', 'default', 'animate',
                     { composer: composer });
    });
  },

  onReplyAll: function(event) {
    Cards.eatEventsUntilNextCard();
    var composer = this.header.replyToMessage('all', function() {
      Cards.pushCard('compose', 'default', 'animate',
                     { composer: composer });
    });
  },

  onForward: function(event) {
    Cards.eatEventsUntilNextCard();
    var composer = this.header.forwardMessage('inline', function() {
      Cards.pushCard('compose', 'default', 'animate',
                     { composer: composer });
    });
  },

  onDelete: function() {
    var dialog = msgDeleteConfirmNode.cloneNode(true);
    ConfirmDialog.show(dialog,
      { // Confirm
        id: 'msg-delete-ok',
        handler: function() {
          var op = this.header.deleteMessage();
          Toaster.logMutation(op, true);
          Cards.removeCardAndSuccessors(this.domNode, 'animate');
        }.bind(this)
      },
      { // Cancel
        id: 'msg-delete-cancel',
        handler: null
      }
    );
  },

  onToggleStar: function() {
    var button = this.domNode.getElementsByClassName('msg-star-btn')[0];
    if (!this.header.isStarred)
      button.classList.add('msg-btn-active');
    else
      button.classList.remove('msg-btn-active');

    this.header.setStarred(!this.header.isStarred);
  },

  onMove: function() {
    //TODO: Please verify move functionality after api landed.
    Cards.folderSelector(function(folder) {
      var op = this.header.moveMessage(folder);
      Toaster.logMutation(op, true);
      Cards.removeCardAndSuccessors(this.domNode, 'animate');
    }.bind(this));
  },

  /**
   * Handle peep bubble click event and trigger context menu.
   */
  onEnvelopeClick: function(event) {
    var target = event.target;
    if (!target.classList.contains('msg-peep-bubble')) {
      return;
    }
    // - peep click
    this.onPeepClick(target);
  },

  onPeepClick: function(target) {
    var contents = msgContactMenuNode.cloneNode(true);
    var email = target.dataset.address;
    var contact = null;
    contents.getElementsByTagName('header')[0].textContent = email;
    document.body.appendChild(contents);

    /*
     * Show menu items based on the options which consists of values of
     * the type "_contextMenuType".
     */
    var showContextMenuItems = (function(options) {
      if (options & this._contextMenuType.VIEW_CONTACT)
        contents.querySelector('.msg-contact-menu-view')
          .classList.remove('collapsed');
      if (options & this._contextMenuType.CREATE_CONTACT)
        contents.querySelector('.msg-contact-menu-create-contact')
          .classList.remove('collapsed');
      if (options & this._contextMenuType.ADD_TO_CONTACT)
        contents.querySelector('.msg-contact-menu-add-to-existing-contact')
          .classList.remove('collapsed');
      if (options & this._contextMenuType.REPLY)
        contents.querySelector('.msg-contact-menu-reply')
          .classList.remove('collapsed');
      if (options & this._contextMenuType.NEW_MESSAGE)
        contents.querySelector('.msg-contact-menu-new')
          .classList.remove('collapsed');
    }).bind(this);

    var updateName = (function(targetMail, name) {
      if (!name || name === '')
        return;

      // update UI
      var selector = '.msg-peep-bubble[data-address="' +
        targetMail + '"]';
      var nodes = Array.prototype.slice
        .call(this.domNode.querySelectorAll(selector));

      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var content = node.querySelector('.msg-peep-content');
        node.dataset.name = name;
        content.textContent = name;
      }
    }).bind(this);

    var formSubmit = (function(evt) {
      document.body.removeChild(contents);
      switch (evt.explicitOriginalTarget.className) {
        // All of these mutations are immediately reflected, easily observed
        // and easily undone, so we don't show them as toaster actions.
        case 'msg-contact-menu-new':
          var composer =
            MailAPI().beginMessageComposition(this.header, null, null,
            function composerReady() {
              composer.to = [{
                address: target.dataset.address,
                name: target.dataset.name
              }];
              Cards.pushCard('compose', 'default', 'animate',
                             { composer: composer });
            });
          break;
        case 'msg-contact-menu-view':
          if (contact) {
            var activity = new MozActivity({
              name: 'open',
              data: {
                type: 'webcontacts/contact',
                params: {
                  'id': contact.id
                }
              }
            });
          }
          break;
        case 'msg-contact-menu-create-contact':
          var params = {
            'email': email
          };

          if (name)
            params['givenName'] = target.dataset.name;

          var activity = new MozActivity({
            name: 'new',
            data: {
              type: 'webcontacts/contact',
              params: params
            }
          });

          activity.onsuccess = function() {
            var contact = activity.result.contact;
            if (contact)
              updateName(email, contact.name);
          };
          break;
        case 'msg-contact-menu-add-to-existing-contact':
          var activity = new MozActivity({
            name: 'update',
            data: {
              type: 'webcontacts/contact',
              params: {
                'email': email
              }
            }
          });

          activity.onsuccess = function() {
            var contact = activity.result.contact;
            if (contact)
              updateName(email, contact.name);
          };
          break;
        case 'msg-contact-menu-reply':
          //TODO: We need to enter compose view with specific email address.
          var composer = this.header.replyToMessage(null, function() {
            Cards.pushCard('compose', 'default', 'animate',
                           { composer: composer });
          });
          break;
      }
      return false;
    }).bind(this);
    contents.addEventListener('submit', formSubmit);

    ContactDataManager.searchContactData(email, function(contacts) {
      var contextMenuOptions = this._contextMenuType.NEW_MESSAGE;
      var messageType = target.dataset.type;

      if (messageType === 'from')
        contextMenuOptions |= this._contextMenuType.REPLY;

      if (contacts && contacts.length > 0) {
        contact = contacts[0];
        contextMenuOptions |= this._contextMenuType.VIEW_CONTACT;
      } else {
        contact = null;
        contextMenuOptions |= this._contextMenuType.CREATE_CONTACT;
        contextMenuOptions |= this._contextMenuType.ADD_TO_CONTACT;
      }
      showContextMenuItems(contextMenuOptions);
    }.bind(this));
  },

  onLoadBarClick: function(event) {
    var self = this;
    var loadBar =
          this.domNode.getElementsByClassName('msg-reader-load-infobar')[0];
    if (!this.body.embeddedImagesDownloaded) {
      this.body.downloadEmbeddedImages(function() {
        // this gets nulled out when we get killed, so use this to bail.
        // XXX of course, this closure will cause us to potentially hold onto
        // a lot of garbage, so it would be better to add an
        // 'onimagesdownloaded' to body so that the closure would end up as
        // part of a cycle that would get collected.
        if (!self.domNode)
          return;

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
  },

  onDownloadAttachmentClick: function(node, attachment) {
    node.setAttribute('state', 'downloading');
    attachment.download(function downloaded() {
      if (!attachment._file)
        return;

      node.setAttribute('state', 'downloaded');
    });
  },

  onViewAttachmentClick: function(node, attachment) {
    console.log('trying to open', attachment._file, 'type:',
                attachment.mimetype);
    if (!attachment._file)
      return;

    if (attachment.isDownloaded) {
      this.getAttachmentBlob(attachment, function(blob) {
        try {
          // Now that we have the file, use an activity to open it
          if (!blob) {
            throw new Error('Blob does not exist');
          }

          // To delegate a correct activity, we should try to avoid the unsure
          // mimetype because types like "application/octet-stream" which told
          // by the e-mail client are not supported.
          // But it doesn't mean we really don't support that attachment
          // what we can do here is:
          // 1. Check blob.type, most of the time it will not be empty
          //    because it's reported by deviceStorage, it should be a
          //    correct mimetype, or
          // 2. Use the original mimetype from the attachment,
          //    but it's possibly an unsupported mimetype, like
          //    "application/octet-stream" which cannot be used correctly, or
          // 3. Use MimeMapper to help us, if it's still an unsure mimetype,
          //    MimeMapper can guess the possible mimetype from extension,
          //    then we can delegate a right activity.
          var extension = attachment.filename.split('.').pop();
          var originalType = blob.type || attachment.mimetype;
          var mappedType = (MimeMapper.isSupportedType(originalType)) ?
            originalType : MimeMapper.guessTypeFromExtension(extension);

          var activity = new MozActivity({
            name: 'open',
            data: {
              type: mappedType,
              blob: blob
            }
          });
          activity.onerror = function() {
            console.warn('Problem with "open" activity', activity.error.name);
          };
          activity.onsuccess = function() {
            console.log('"open" activity allegedly succeeded');
          };
        }
        catch (ex) {
          console.warn('Problem creating "open" activity:', ex, '\n', ex.stack);
        }
      });
    }
  },

  onHyperlinkClick: function(event, linkNode, linkUrl, linkText) {
    var dialog = msgBrowseConfirmNode.cloneNode(true);
    var content = dialog.getElementsByTagName('p')[0];
    content.textContent = mozL10n.get('browse-to-url-prompt', { url: linkUrl });
    ConfirmDialog.show(dialog,
      { // Confirm
        id: 'msg-browse-ok',
        handler: function() {
          window.open(linkUrl, '_blank');
        }.bind(this)
      },
      { // Cancel
        id: 'msg-browse-cancel',
        handler: null
      }
    );
  },

  _populatePlaintextBodyNode: function(bodyNode, rep) {
    for (var i = 0; i < rep.length; i += 2) {
      var node = document.createElement('div'), cname;

      var etype = rep[i] & 0xf, rtype = null;
      if (etype === 0x4) {
        var qdepth = (((rep[i] >> 8) & 0xff) + 1);
        if (qdepth > 8)
          cname = MAX_QUOTE_CLASS_NAME;
        else
          cname = CONTENT_QUOTE_CLASS_NAMES[qdepth];
      }
      else {
        cname = CONTENT_TYPES_TO_CLASS_NAMES[etype];
      }
      if (cname)
        node.setAttribute('class', cname);

      var subnodes = MailAPI().utils.linkifyPlain(rep[i + 1], document);
      for (var iNode = 0; iNode < subnodes.length; iNode++) {
        node.appendChild(subnodes[iNode]);
      }

      bodyNode.appendChild(node);
    }
  },

  buildHeaderDom: function(domNode) {
    var header = this.header, body = this.body;

    // -- Header
    function addHeaderEmails(type, peeps) {
      var lineClass = 'msg-envelope-' + type + '-line';
      var lineNode = domNode.getElementsByClassName(lineClass)[0];

      if (!peeps || !peeps.length) {
        lineNode.classList.add('collapsed');
        return;
      }

      // Because we can avoid having to do multiple selector lookups, we just
      // mutate the template in-place...
      var peepTemplate = msgPeepBubbleNode,
          contentTemplate =
            peepTemplate.getElementsByClassName('msg-peep-content')[0];

      // If the address field is "From", We only show the address and display
      // name in the message header.
      if (lineClass == 'msg-envelope-from-line') {
        var peep = peeps[0];
        // TODO: Display peep name if the address is not exist.
        //       Do we nee to deal with that scenario?
        contentTemplate.textContent = peep.name || peep.address;
        peepTemplate.dataset.address = peep.address;
        peepTemplate.dataset.name = peep.name;
        peepTemplate.dataset.type = type;
        if (peep.address) {
          contentTemplate.classList.add('msg-peep-address');
        }
        lineNode.appendChild(peepTemplate.cloneNode(true));
        domNode.getElementsByClassName('msg-reader-header-label')[0]
          .textContent = peep.name || peep.address;
        return;
      }
      for (var i = 0; i < peeps.length; i++) {
        var peep = peeps[i];
        contentTemplate.textContent = peep.name || peep.address;
        peepTemplate.dataset.address = peep.address;
        peepTemplate.dataset.name = peep.name;
        peepTemplate.dataset.type = type;
        if (!peep.name && peep.address) {
          contentTemplate.classList.add('msg-peep-address');
        } else {
          contentTemplate.classList.remove('msg-peep-address');
        }
        lineNode.appendChild(peepTemplate.cloneNode(true));
      }
    }

    addHeaderEmails('from', [header.author]);
    addHeaderEmails('to', header.to);
    addHeaderEmails('cc', header.cc);
    addHeaderEmails('bcc', header.bcc);

    var dateNode = domNode.getElementsByClassName('msg-envelope-date')[0];
    dateNode.dataset.time = header.date.valueOf();
    dateNode.textContent = prettyDate(header.date);

    displaySubject(domNode.getElementsByClassName('msg-envelope-subject')[0],
                   header);
  },

  buildBodyDom: function() {
    var body = this.body;
    var domNode = this.domNode;

    var rootBodyNode = domNode.getElementsByClassName('msg-body-container')[0],
        reps = body.bodyReps,
        hasExternalImages = false,
        showEmbeddedImages = body.embeddedImageCount &&
                             body.embeddedImagesDownloaded;

    iframeShims.bindSanitizedClickHandler(rootBodyNode,
                              this.onHyperlinkClick.bind(this),
                              rootBodyNode);

    for (var iRep = 0; iRep < reps.length; iRep++) {
      var rep = reps[iRep];

      if (rep.type === 'plain') {
        this._populatePlaintextBodyNode(rootBodyNode, rep.content);
      }
      else if (rep.type === 'html') {
        var iframeShim = iframeShims.createAndInsertIframeForContent(
          rep.content, this.scrollContainer, rootBodyNode, null,
          'interactive', this.onHyperlinkClick.bind(this));
        var iframe = iframeShim.iframe;
        var bodyNode = iframe.contentDocument.body;
        this.iframeResizeHandler = iframeShim.resizeHandler;
        MailAPI().utils.linkifyHTML(iframe.contentDocument);
        this.htmlBodyNodes.push(bodyNode);

        if (body.checkForExternalImages(bodyNode))
          hasExternalImages = true;
        if (showEmbeddedImages)
          body.showEmbeddedImages(bodyNode);
      }

      if (iRep === 0) {
        // remove progress bar
        var progressNode = rootBodyNode.querySelector('progress');
        if (progressNode) {
          progressNode.parentNode.removeChild(progressNode);
        }
      }
    }

    // -- HTML-referenced Images
    var loadBar = domNode.getElementsByClassName('msg-reader-load-infobar')[0];
    if (body.embeddedImageCount && !body.embeddedImagesDownloaded) {
      loadBar.classList.remove('collapsed');
      loadBar.textContent =
        mozL10n.get('message-download-images',
                    { n: body.embeddedImageCount });
    }
    else if (hasExternalImages) {
      loadBar.classList.remove('collapsed');
      loadBar.textContent =
        mozL10n.get('message-show-external-images');
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
      domNode.getElementsByClassName('msg-attachments-container')[0];
    if (body.attachments && body.attachments.length) {
      // We need MimeMapper to help us determining the downloadable attachments
      // but it might not be loaded yet, so load before use it
      require(['shared/mime_mapper'], function(mapper) {
        if (!MimeMapper)
          MimeMapper = mapper;

        var attTemplate = msgAttachmentItemNode,
            filenameTemplate =
              attTemplate.getElementsByClassName('msg-attachment-filename')[0],
            filesizeTemplate =
              attTemplate.getElementsByClassName('msg-attachment-filesize')[0];
        for (var iAttach = 0; iAttach < body.attachments.length; iAttach++) {
          var attachment = body.attachments[iAttach], state;
          var extension = attachment.filename.split('.').pop();

          if (attachment.isDownloaded)
            state = 'downloaded';
          else if (MimeMapper.isSupportedType(attachment.mimetype) ||
                   MimeMapper.isSupportedExtension(extension))
            state = 'downloadable';
          else
            state = 'nodownload';
          attTemplate.setAttribute('state', state);
          filenameTemplate.textContent = attachment.filename;
          filesizeTemplate.textContent = prettyFileSize(
            attachment.sizeEstimateInBytes);

          var attachmentNode = attTemplate.cloneNode(true);
          attachmentsContainer.appendChild(attachmentNode);
          attachmentNode.getElementsByClassName('msg-attachment-download')[0]
            .addEventListener('click',
                              this.onDownloadAttachmentClick.bind(
                                this, attachmentNode, attachment));
          attachmentNode.getElementsByClassName('msg-attachment-view')[0]
            .addEventListener('click',
                              this.onViewAttachmentClick.bind(
                                this, attachmentNode, attachment));
        }
      }.bind(this));
    }
    else {
      attachmentsContainer.classList.add('collapsed');
    }
  },

  die: function() {
    if (this.body) {
      this.body.die();
      this.body = null;
    }
    this.domNode = null;
  }
};
Cards.defineCardWithDefaultMode(
    'message-reader',
    { tray: false },
    MessageReaderCard,
    templateNode
);

});
