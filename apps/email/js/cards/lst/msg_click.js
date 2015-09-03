'use strict';

define(function(require, exports) {

var cards = require('cards');

/**
 * A mixin for lst cards that want tapping on a message to go to a message
 * reader. Check all the `this` references below to see implicit dependencies
 * on instance state.
 * A longer range TODO is to remove or make explicit the dependencies.
 */

return {
//todo: test this, might need to do more here. Binds to
//this.listCursor.on('messageSuidNotFound', this.listNavOnMessageSuidNotFound);
  listNavOnMessageSuidNotFound: function(messageSuid) {
    // If no message was found, then go back. This card
    // may have been created from obsolete data, like an
    // old notification for a message that no longer exists.
    // This stops atTop since the most likely case for this
    // entry point is either clicking on a message that is
    // at the top of the inbox in the HTML cache, or from a
    // notification for a new message, which would be near
    // the top.
    if (this.messageSuid === messageSuid) {
      this.onBack();
    }
  },

  pushCardForItem: function(mailConversation) {
    cards.add('animate', 'item_detail', {
      model: this.model,
      listCursor: this.listCursor
    });
  },

  onClickMessage: function(event) {
    var messageNode = event.detail;

    // You cannot open a message if this is the outbox and it is syncing.
    if (this.curFolder &&
        this.curFolder.type === 'outbox' && this.outboxSyncInProgress) {
      return;
    }

    var dataItem = messageNode.message;

    // Skip nodes that are default/placeholder ones.
    if (dataItem && dataItem.isPlaceholderData) {
      return;
    }

    // If in edit mode, the clicks on message nodes are about changing the
    // selection for bulk edit actions.
    if (this.editMode) {
      this.toggleSelection(messageNode);
      return;
    }

//todo: better is message has isDraft on it, instead of
//checking curFolder type?
    if (this.curFolder && this.curFolder.type === 'localdrafts' &&
        dataItem.hasDrafts && dataItem.messageCount === 1) {
        var messageList = dataItem.viewMessages();
        messageList.seekToTop(1, 1);
        messageList.once('seeked', () => {
          var message = messageList.items[0];
          message.editAsDraft().then((composer) => {
            cards.add('animate', 'compose', {
              model: this.model,
              composer
            });
          }).catch(function(err) {
            console.log(err);
          });
        });
      return;
    }

//todo: test this
    // When tapping a message in the outbox, don't open the message;
    // instead, move it to localdrafts and edit the message as a
    // draft.
    if (this.curFolder && this.curFolder.type === 'outbox') {
      // If the message is currently being sent, abort.
      if (dataItem.sendProblems.state === 'sending') {
        return;
      }
      var draftsFolder =
            this.model.foldersSlice.getFirstFolderWithType('localdrafts');

      console.log('outbox: Moving message to localdrafts.');
      this.model.api.moveMessages([dataItem], draftsFolder, (moveMap) => {
        dataItem.id = moveMap[dataItem.id];
        console.log('outbox: Editing message in localdrafts.');
        dataItem.editAsDraft().then((composer) => {
          cards.add('animate', 'compose', {
            model: this.model,
            composer
          });
        }).catch(function(err) {
          console.log(err);
        });
      });
      return;
    }

    if (dataItem) {
      this.listCursor.setCurrentItem(dataItem);
    } else if (messageNode.dataset.id) {
//todo: need to fix this to go to the right place
      // a case where dataItem was not set yet, like clicking on a
      // html cached node, or virtual scroll item that is no
      // longer backed by a dataItem.
      this.listCursor.setCurrentItemBySuid(messageNode.dataset.id);
    } else {
      // Not an interesting click, bail
      return;
    }


    this.pushCardForItem(dataItem);
  }
};

});
