/*global FontSizeUtils, requestAnimationFrame */

define(function(require) {
'use strict';

var cards = require('cards'),
    itemTemplateNode = require('tmpl!./msg/conv_message_item.html'),
    date = require('date'),
    ListCursor = require('list_cursor'),
    messageDisplay = require('message_display'),
    mozL10n = require('l10n!'),
    updatePeepDom = require('./lst/peep_dom').update;

return [
  require('./base_card')(require('template!./conv_list.html')),
  require('./lst/edit_controller'),
  require('./lst/msg_click'),
  {
    createdCallback: function() {
      // Binding "this" to some functions as they are used for event listeners.
      this.advanceMessagesListCursor = this.advanceMessagesListCursor
                                       .bind(this);
    },

    onArgs: function(args) {
      this.model = args.model;
      this.readerAdvance = args.readerAdvance;
      if (args.onBack) {
        this.onBack = args.onBack;
      }
    },

    itemTemplateNode,

    emptyListL10nId: 'messages-conversation-empty',

    // Listener for msg_vscroll event.
    emptyLayoutShown: function() {
      this.editBtn.disabled = true;
    },

    // Listener for msg_vscroll event.
    emptyLayoutHidden: function() {
      this.editBtn.disabled = false;
    },

    // Listener for msg_vscroll event.
    messagesChange: function(event) {
      var { message } = event;
      this.updateMessageDom(message);
    },

    /**
     * This is called by the item_detail that owns this conv_list instance, when
     * its listCursor changes. The listCursor tracked by this instance is the
     * one for the messages in this conversation, a different one.
     * @param {ListCursor.CurrentItem} currentItem
     */
    setCurrentItem: function(currentItem) {
      var mailConversation = this.mailConversation = currentItem.item;
      var listCursor = this.listCursor = new ListCursor();

      this.updateTitle(mailConversation);

      this.msgVScrollContainer.emit('listCursor', listCursor);

      // Now that a folder is available, enable edit mode toggling.
      this.editModeEnabled = true;
      this.editToolbar.folderType = null;

      if (mailConversation) {
        listCursor.bindToList(mailConversation.viewMessages());
      }

      // Previous.
      var hasPrevious = currentItem.siblings.hasPrevious;
      this.previousBtn.disabled = !hasPrevious;
      this.previousIcon.classList[hasPrevious ? 'remove' : 'add'](
        'icon-disabled');

      // Next.
      var hasNext = currentItem.siblings.hasNext;
      this.nextBtn.disabled = !hasNext;
      this.nextIcon.classList[hasNext ? 'remove' : 'add']('icon-disabled');
    },

    /**
     * Broadcast that we need to move previous if there's a previous sibling.
     *
     * @param {Event} event previous arrow click event.
     */
    onPrevious: function() {
      this.readerAdvance('previous');
    },

    /**
     * Broadcast that we need to move next if there's a next sibling.
     *
     * @param {Event} event next arrow click event.
     */
    onNext: function() {
      this.readerAdvance('next');
    },

    advanceMessagesListCursor: function(direction) {
      this.listCursor.advance(direction);
    },

    /**
     * This overrides the pushCardForItem in msg_click.
     */
    pushCardForItem: function() {
      cards.add('animate', 'message_reader', {
        model: this.model,
        listCursor: this.listCursor,
        readerAdvance: this.advanceMessagesListCursor
      });
    },

    /**
     * Called from edit_controller mixin when the edit mode has changed. Used to
     * allow classes mixing in edit_controller to update UI state based on edit
     * state.
     */
    editModeChanged: function(enabled) {
      if (enabled) {
        this.header.classList.add('collapsed');
        this.normalToolbar.classList.add('collapsed');
        this.editHeader.classList.remove('collapsed');
        this.editToolbar.classList.remove('collapsed');
      } else {
        this.header.classList.remove('collapsed');
        this.normalToolbar.classList.remove('collapsed');
        this.editHeader.classList.add('collapsed');
        this.editToolbar.classList.add('collapsed');
      }
    },

    updateTitle: function(mailConversation) {
      messageDisplay.subject(this.subjectDisplay, mailConversation);

      if (mailConversation) {
        requestAnimationFrame(() => {
          FontSizeUtils._reformatHeaderText(this.folderLabel);
        });
      }
    },

    /**
     * Update the state of the given DOM node.  Note that DOM nodes are reused
     * so you must ensure that this method cleans up any dirty state resulting
     * from any possible prior operation of this method.
     */
    updateMessageDom: function(message) {
      var msgNode = message.element;

      if (!msgNode) {
        return;
      }

      msgNode.classList.toggle('draft', message.isDraft);

      // If the placeholder data, indicate that in case VScroll
      // wants to go back and fix later.
      var classAction = message.isPlaceholderData ? 'add' : 'remove';
      msgNode.classList[classAction]('default-data');

      // ID is stored as a data- attribute so that it can survive
      // serialization to HTML for storing in the HTML cache, and
      // be usable before the actual data from the backend has
      // loaded, as clicks to the message list are allowed before
      // the back end is available. For this reason, click
      // handlers should use dataset.id when wanting the ID.
      msgNode.dataset.id = message.id;

      // some things only need to be done once
      var dateNode = msgNode.querySelector('.msg-message-date');
      var snippetNode = msgNode.querySelector('.msg-message-snippet');

      var listPerson;
      listPerson = message.author;
      // author
      listPerson.element =
        msgNode.querySelector('.msg-message-author');
      listPerson.onchange = updatePeepDom;
      listPerson.onchange(listPerson);
      // date
      var dateTime = dateNode.dataset.time = message.date.valueOf();
      date.relativeDateElement(dateNode, dateTime);

      // attachments (can't change within a message but can change between
      // messages, and since we reuse DOM nodes...)
      var attachmentsNode = msgNode.querySelector('.msg-message-attachments');
      attachmentsNode.classList.toggle('msg-message-attachments-yes',
                                       message.hasAttachments);
      // snippet needs to be shorter if icon is shown
      snippetNode.classList.toggle('icon-short', message.hasAttachments);

      // snippet
      snippetNode.textContent = message.snippet;
      snippetNode.classList.toggle('icon-short', message.isStarred);

      // update styles throughout the node for read vs unread
      msgNode.classList.toggle('unread', (!message.isRead && !message.isDraft));

      // star
      var starNode = msgNode.querySelector('.msg-message-star');

      starNode.classList.toggle('msg-message-star-starred', message.isStarred);

      // sync status
      var syncNode =
            msgNode.querySelector('.msg-message-syncing-section');

      // sendProblems is only intended for outbox messages, so not all
      // messages will have sendProblems defined.
      var sendProblems = message.sendProblems && message.sendProblems.state;

      syncNode.classList.toggle('msg-message-syncing-section-syncing',
                                sendProblems === 'sending');
      syncNode.classList.toggle('msg-message-syncing-section-error',
                                sendProblems === 'error');

      // Set the accessible label for the syncNode.
      if (sendProblems) {
        mozL10n.setAttributes(syncNode, 'message-message-state-' +
                                        sendProblems);
      } else {
        syncNode.removeAttribute('data-l10n-id');
      }

      // edit mode select state, defined in lst/edit_controller
      this.updateDomSelectState(msgNode, message);
    },

    release: function() {
      if (this.listCursor) {
        this.listCursor.release();
      }
      this.msgVScroll.release();
    }
  }
];

});
