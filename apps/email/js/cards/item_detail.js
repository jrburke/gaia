'use strict';
define(function(require) {

var ListCursor = require('list_cursor');

return [
  require('./base_card')(require('template!./item_detail.html')),
  {
    createdCallback: function() {
      this._emittedContentEvents = false;
    },

    onArgs: function(args) {
      this.model = args.model;

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
      this.convList.onCardVisible();
    },

    readerAdvance: function (direction) {
      this.listCursor.advance(direction);
    },

    setCurrentItem: function(currentItem) {
      var mailConversation = currentItem.item;
      if (mailConversation.messageCount < 2) {
        this.convList.classList.add('collapsed');
        this.reader.classList.remove('collapsed');

        var messageList = mailConversation.viewMessages();
console.log('ITEM_DETAIL CALLING SEEKTOTOP 1, 1');
        messageList.seekToTop(1, 1);
        messageList.once('seeked', () => {
          var message = messageList.items[0];

          this.reader.setCurrentMessage(new ListCursor
                     .CurrentItem(message, currentItem.siblings));
        });
      } else {
        this.convList.classList.remove('collapsed');
        this.reader.classList.add('collapsed');

        this.convList.setCurrentItem(currentItem);
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
