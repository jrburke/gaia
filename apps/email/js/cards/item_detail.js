'use strict';
define(function(require) {

var ListCursor = require('list_cursor');

// The no-state currentItem to use when wanting to clear the display
// of a sub-view.
var emptyItem = {
  currentItem: null,
  siblings: {
    hasPrevious: false,
    hasNext: false
  }
};

return [
  require('./base_card')(require('template!./item_detail.html')),
  {
    createdCallback: function() {
      this._emittedContentEvents = false;
    },

    onArgs: function(args) {
      this.model = args.model;
      this.focusedView = null;

      this.listCursor = args.listCursor;
      this.onCurrentItem = (currentItem) => {
        this.setCurrentItem(currentItem);
      };

      var readerAdvance = this.readerAdvance.bind(this),
          onBack = this.onBack.bind(this);

      this.convList.onArgs({
        model: this.model,
        readerAdvance: readerAdvance,
        onBack: onBack
      });

      this.reader.onArgs({
        model: this.model,
        readerAdvance: readerAdvance,
        onBack: onBack
      });

      this.listCursor.latest('currentItem', this.onCurrentItem);
    },

    postInsert: function() {
      this.reader.postInsert();
    },

    onCardVisible: function() {
      if (this.focusedView === this.convList) {
        this.convList.onCardVisible();
      }
    },

    readerAdvance: function (direction) {
      this.listCursor.advance(direction);
    },

    setCurrentItem: function(currentItem) {
      var mailConversation = currentItem.item;
      if (mailConversation.messageCount < 2) {
        this.convList.classList.add('collapsed');
        this.reader.classList.remove('collapsed');
        this.focusedView = this.reader;

        var onSeeked = () => {
          var message = messageList.items[0];
          if (!message) {
            //todo: figure out why this can happen. This is why this is a
            // separate function that is a on('seeked' instead of a
            // once('seeked')
            console.error('Unexpected: no message in item_detail seeked.');
            return;
          }
          messageList.removeListener('seeked', onSeeked);

          this.reader.setCurrentMessage(new ListCursor
                     .CurrentItem(message, currentItem.siblings));
        };

        var messageList = mailConversation.viewMessages();
console.log('ITEM_DETAIL CALLING SEEKTOTOP 1, 1');
        messageList.seekToTop(1, 1);
        messageList.on('seeked', onSeeked);

        // Clear the conv view so that next transition to it does not show
        // the previous state.
        this.convList.setCurrentItem(emptyItem);
      } else {
        this.convList.classList.remove('collapsed');
        this.reader.classList.add('collapsed');
        this.focusedView = this.convList;

        this.convList.setCurrentItem(currentItem);
        this.convList.onCardVisible();

        // Clear the reader view so that next transition to it does not show
        // the previous state.
        this.reader.setCurrentMessage(emptyItem);
      }
    },

    release: function() {
      if (this.listCursor) {
        this.listCursor.removeListener(this.onCurrentItem);
      }
    }
  }
];
});
