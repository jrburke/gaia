'use strict';

define(function(require, exports) {

var cards = require('cards'),
    ConfirmDialog = require('confirm_dialog'),
    folderSelector = require('folder_selector'),
    mozL10n = require('l10n!'),
    msgAttachmentDisabledConfirmNode =
                         require('tmpl!./attachment_disabled_confirm.html'),
    msgDeleteConfirmNode = require('tmpl!./delete_confirm.html'),
    msgReplyMenuNode = require('tmpl!./reply_menu.html'),
    toaster = require('toaster');

var slice = Array.prototype.slice;

return [
  require('../base')(require('template!./reader_toolbar.html')),
  {
    setState: function(model, message, body) {
      this.model = model;
      this.message = message;
      this.body = body;
      this.disabled = false;

      this.classList.toggle('draft', message.isDraft);

      if (!message.isDraft) {
        // - mark message read (if it is not already)
        if (!message.isRead) {
          message.setRead(true);
        } else {
          this.readBtn.classList.remove('unread');
          mozL10n.setAttributes(this.readBtn, 'message-mark-read-button');
        }

        this.starBtn.classList.toggle('msg-star-btn-on',
                                       this.message.isStarred);
        this.starBtn.setAttribute('aria-pressed',
          this.message.isStarred);
      }
    },

    attributeChangedCallback: function(attrName, oldVal, newVal) {
      if (attrName === 'disabled') {
        this._setDisabled(!!newVal);
      }
    },

    _setDisabled: function(isDisabled) {
      slice.call(this.getElementsByTagName('button')).forEach(function(node) {
        node.disabled = isDisabled;
      });
    },

    reply: function() {
      cards.eatEventsUntilNextCard();
      this.message.replyToMessage('sender').then((composer) => {
        cards.add('animate', 'compose', {
          model: this.model,
          composer: composer
        });
      }).catch(function(err) {
        console.log(err);
      });
    },

    replyAll: function() {
      cards.eatEventsUntilNextCard();
      this.message.replyToMessage('all').then((composer) => {
        cards.add('animate', 'compose', {
          model: this.model,
          composer: composer
        });
      }).catch(function(err) {
        console.log(err);
      });
    },

    forward: function() {
      var needToPrompt = this.message.hasAttachments ||
        this.body.embeddedImageCount > 0;

      var forwardMessage = (() => {
        cards.eatEventsUntilNextCard();
        this.message.forwardMessage('inline').then((composer) => {
          cards.add('animate', 'compose', {
            model: this.model,
            composer: composer
          });
        }).catch(function(err) {
          console.log(err);
        });
      });

      if (needToPrompt) {
        var dialog = msgAttachmentDisabledConfirmNode.cloneNode(true);
        ConfirmDialog.show(dialog,
          {
            id: 'msg-attachment-disabled-ok',
            handler: function() {
              forwardMessage();
            }
          },
          {
            id: 'msg-attachment-disabled-cancel',
            handler: null
          }
        );
      } else {
        forwardMessage();
      }
    },


    // TODO: canReplyAll should be moved into GELAM.
    /** Returns true if Reply All should be shown as a distinct option. */
    canReplyAll: function() {
      // If any e-mail is listed as 'to' or 'cc' and doesn't match this
      // user's account, 'Reply All' should be enabled.
      var myAddresses = this.model.account.identities.map(function(ident) {
        return ident.address;
      });

      var otherAddresses = (this.message.to || [])
                           .concat(this.message.cc || []);
      if (this.message.replyTo && this.message.replyTo.author) {
        otherAddresses.push(this.message.replyTo.author);
      }
      for (var i = 0; i < otherAddresses.length; i++) {
        var otherAddress = otherAddresses[i];
        if (otherAddress.address &&
            myAddresses.indexOf(otherAddress.address) == -1) {
          return true;
        }
      }

      return false;
    },

    onReplyMenu: function(event) {
      var contents = msgReplyMenuNode.cloneNode(true);
      cards.setStatusColor(contents);
      document.body.appendChild(contents);

      // reply menu selection handling
      var formSubmit = (evt) => {
        cards.setStatusColor();
        document.body.removeChild(contents);
        switch (evt.explicitOriginalTarget.className) {
        case 'msg-reply-menu-reply':
          this.reply();
          break;
        case 'msg-reply-menu-reply-all':
          this.replyAll();
          break;
        case 'msg-reply-menu-forward':
          this.forward();
          break;
        case 'msg-reply-menu-cancel':
          break;
        }
        return false;
      };
      contents.addEventListener('submit', formSubmit);

      if (!this.canReplyAll()) {
        contents.querySelector('.msg-reply-menu-reply-all')
          .classList.add('collapsed');
      }
    },

    setRead: function(isRead) {
      this.message.isRead = isRead;
      this.message.setRead(isRead);

      // Want the button state to reflect the current read state.
      this.readBtn.classList.toggle('unread', !isRead);
      mozL10n.setAttributes(this.readBtn,
        isRead ? 'message-mark-read-button' : 'message-mark-unread-button');
    },

    onMarkRead: function() {
      this.setRead(!this.message.isRead);
    },

    onDelete: function() {
      var dialog = msgDeleteConfirmNode.cloneNode(true);
      var content = dialog.getElementsByTagName('p')[0];
      var l10nId = this.message.isDraft ?
                   'draft-delete-confirm' : 'message-edit-delete-confirm';
      mozL10n.setAttributes(content, l10nId);
      ConfirmDialog.show(dialog,
        { // Confirm
          id: 'msg-delete-ok',
          handler: () => {
            if (this.message.isDraft) {
//todo: is there a shorter way to do this?
              this.message.editAsDraft().then((composer) => {
                composer.abortCompositionDeleteDraft();
                composer.release();
                this.emitDomEvent('deleted');
              });
            } else {
              var op = this.message.deleteMessage();
              this.emitDomEvent('deleted');
              toaster.toastOperation(op);
            }
          }
        },
        { // Cancel
          id: 'msg-delete-cancel',
          handler: null
        }
      );
    },

    onToggleStar: function() {
      this.starBtn.classList.toggle('msg-star-btn-on', !this.message.isStarred);

      this.message.isStarred = !this.message.isStarred;
      this.starBtn.setAttribute('aria-pressed', this.message.isStarred);
      this.message.setStarred(this.message.isStarred);
    },

    onMove: function() {
      //TODO: Please verify move functionality after api landed.
      folderSelector(this.model, (folder) => {
        var op = this.message.moveMessage(folder);
        this.emitDomEvent('moved');
        toaster.toastOperation(op);
      }, function(folder) {
        return folder.isValidMoveTarget;
      });
    },

    onEditDraft: function() {
      this.emitDomEvent('editDraft');
    }
  }
];

});
