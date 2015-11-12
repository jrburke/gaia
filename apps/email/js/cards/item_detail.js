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

        var onSeeked = () => {
          var message = messageList.items[0];
          if (!message) {
            //todo: figure out why this can happen. This is why this is a
            // separate function that is a on('seeked' instead of a
            // once('seeked')
            console.error('Unexpected: no message in item_detail seeked.');
            return;
          }
          messageList.removeListener(onSeeked);

          this.reader.setCurrentMessage(new ListCursor
                     .CurrentItem(message, currentItem.siblings));
        };

        var messageList = mailConversation.viewMessages();
console.log('ITEM_DETAIL CALLING SEEKTOTOP 1, 1');
        messageList.seekToTop(1, 1);
        messageList.on('seeked', onSeeked);
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
