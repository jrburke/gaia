'use strict';
define(function(require) {

var cards = require('cards'),
    date = require('date'),
    evt = require('evt'),
    largeMessageConfirm = require('./msg/large_message_confirm'),
    messageDisplay = require('message_display');

return [
  require('./base_card')(require('template!./message_reader.html')),
  {
    createdCallback: function() {
      this._emittedContentEvents = false;
    },

    onArgs: function(args) {
      this.model = args.model;
      this.envelopeBar.model = args.model;

      this.messageSuid = args.messageSuid;
      this.readerAdvance = args.readerAdvance;
      if (args.onBack) {
        this.onBack = args.onBack;
      }

      if (args.listCursor) {
        this.listCursor = args.listCursor;
        this.onCurrentItem = (currentItem) => {
          this.setCurrentMessage(currentItem);
        };

        this.listCursor.latest('currentItem', this.onCurrentItem);
      }
    },

    /**
     * Inform Cards to not emit startup content events, this card will trigger
     * them once data from back end has been received and the DOM is up to date
     * with that data.
     * @type {Boolean}
     */
    skipEmitContentEvents: true,

    postInsert: function() {
      this._inDom = true;

      // If have a message that is waiting for the DOM, finish
      // out the display work.
      if (this._afterInDomMessage) {
        this.setCurrentMessage(this._afterInDomMessage);
        this._afterInDomMessage = null;
      }
    },

    told: function(args) {
      if (args.messageSuid) {
        this.messageSuid = args.messageSuid;
      }
    },

    onBack: function(event) {
      cards.removeCardAndSuccessors(this, 'animate');
    },

    /**
     * Broadcast that we need to move previous if there's a previous sibling.
     *
     * @param {Event} event previous arrow click event.
     */
    onPrevious: function(event) {
      this.readerAdvance('previous');
    },

    /**
     * Broadcast that we need to move next if there's a next sibling.
     *
     * @param {Event} event next arrow click event.
     */
    onNext: function(event) {
      this.readerAdvance('next');
    },

    /**
     * Set the message we're reading.
     *
     * @param {MessageCursor.CurrentMessage} currentMessage representation of
     * the email we're currently reading.
     */
    setCurrentMessage: function(currentItem) {
      // If the card is not in the DOM yet, do not proceed, as
      // the iframe work needs to happen once DOM is available.
      if (!this._inDom) {
        this._afterInDomMessage = currentItem;
        return;
      }

      // Ignore doing extra work if current message is the same as the one
      // already tied to this message reader.
      if (this.message && currentItem.item &&
          this.message.id === currentItem.item.id) {
        return;
      }

      this.messageSuid = null;
      this.clearDom();

      this.message = currentItem.item;

      this.envelopeBar.setMessage(this.message);

      // If message is too big, ask first before downloading. If user declines,
      // then just go back a screen, since canceling the event is difficult
      // to know without too much coupling (was a next/prev arrow pushed, or
      // did the message come from a list view?).
      largeMessageConfirm(this.message).then(() => {
        this.bodyContainer.setState(this.model, this.message);
      }, () => {
        this.onBack();
      });

      this.buildHeaderDom(this);

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

    editDraft: function() {
//todo: convert cards.js to be able to remove this card after pushing the
//compose card.
      this.onBack();
      evt.once('cards:transitionEnd', () => {
        this.message.editAsDraft().then((composer) => {
          cards.pushCard('compose', 'animate', {
            model: this.model,
            composer
          });
        }).catch(function(err) {
          console.log(err);
        });
      });
    },

    updateFromName: function(event) {
      this.querySelector('.msg-reader-header-label')
        .textContent = event.detail;
    },

    buildHeaderDom: function(domNode) {
      var message = this.message;

      var dateNode = domNode.querySelector('.msg-envelope-date');
      var dateTime = dateNode.dataset.time = message.date.valueOf();
      date.relativeDateElement(dateNode, dateTime);

      messageDisplay.subject(domNode.querySelector('.msg-envelope-subject'),
                             message);
    },

    clearDom: function() {
      this.envelopeBar.clear();
      this.attachmentsContainer.clear();
      this.bodyContainer.clear();
    },

    bodyChanged: function(event) {
      var message = event.detail.message,
          changeDetails = event.detail.changeDetails;

      this.attachmentsContainer.setAttachments(message.attachments,
                                               changeDetails);
      this.readerToolbar.setState(this.model, this.message, message);

      // Inform that content is ready. Done here because reply is only enabled
      // once the full body is available.
      if (!this._emittedContentEvents) {
        evt.emit('metrics:contentDone');
        this._emittedContentEvents = true;
      }
    },

    removeLisCursorListener: function() {
      if (this.listCursor) {
        this.listCursor.removeListener(this.onCurrentItem);
      }
    },

    release: function() {
      this.removeLisCursorListener();
      this.bodyContainer.release();
    }
  }
];
});
