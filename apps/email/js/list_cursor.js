/*global define */
'use strict';

define(function(require) {
  var array = require('array'),
      evt = require('evt');

  /**
   * @constructor
   */
  function ListCursor() {
    // Inherit from evt.Emitter.
    evt.Emitter.call(this);
  }

  ListCursor.prototype = evt.mix({
    currentItem: null,

    list: null,

    /**
     * @type {String}
     */
    expectingItemSuid: null,

    chooseAdvanceIndex: function(direction) {
      var index = this.indexOfItemById(this.currentItem.item.id);
      switch (direction) {
        case 'previous':
          index -= 1;
          break;
        case 'next':
          index += 1;
          break;
      }

      var items = this.list.items;
      if (index < 0 || index >= items.length) {
        // We can't advance that far!
        return undefined;
      }

      return index;
    },

    /**
     * @param {string} direction either 'next' or 'previous'.
     */
    advance: function(direction) {
      var index = this.chooseAdvanceIndex(direction);
      if (index === undefined) {
        return;
      }

      this.setCurrentItemByIndex(index);
    },


    /**
     * Peeks at the item given the direction from the currentItem
     * @param  {String} direction 'previous' or 'next'
     * @return {Object} the item at the index. Can be undefined.
     */
    peek: function(direction) {
      var index = this.chooseAdvanceIndex(direction);
      if (index === undefined) {
        return;
      }

      var item = this.list.items[index];

//TODO: done for search lists, can this be revisited?
      if ('message' in item) {
        item = item.message;
      }

      return item;
    },

    /**
     * Tracks a itemSuid to use in selecting
     * the currentItem once the list data loads.
     * @param {String} itemSuid The item suid.
     */
    setCurrentItemBySuid: function(itemSuid) {
      this.expectingItemSuid = itemSuid;
      this.checkExpectingItemSuid();
    },

    /**
     * Sets the currentItem if there are items now to check
     * against expectingItemSuid. Only works if current folder
     * is set to an "inbox" type, so only useful for jumps into
     * the email app from an entry point like a notification.
     * @param  {Boolean} eventIfNotFound if set to true, an event
     * is emitted if the itemSuid is not found in the set of
     * items.
     */
    checkExpectingItemSuid: function(eventIfNotFound) {
      var itemSuid = this.expectingItemSuid;

      if (!this.list || !this.list.items || !this.list.items.length) {
        return;
      }

      var index = this.indexOfItemById(itemSuid);
      if (index > -1) {
        this.expectingItemSuid = null;
        return this.setCurrentItemByIndex(index);
      }

      if (eventIfNotFound) {
        console.error('list_cursor could not find itemSuid ' +
                      itemSuid + ', emitting itemSuidNotFound');
        this.emit('itemSuidNotFound', itemSuid);
      }
    },

    setCurrentItem: function(item) {
      if (!item) {
        return;
      }

      this.setCurrentItemByIndex(this.indexOfItemById(item.id));
    },

    setCurrentItemByIndex: function(index) {
      var items = this.list.items;

      // Do not bother if not a valid index.
      if (index === -1 || index > items.length - 1) {
        return;
      }

//TODO: done for search lists, can this be revisited?
      var item = items[index];
      if ('message' in item) {
        item = item.message;
      }

      var currentItem = new CurrentItem(item, {
        hasPrevious: index !== 0,                 // Can't be first
        hasNext: index !== items.length - 1    // Can't be last
      });

      this.currentItem = currentItem;
      this.emit('currentItem', currentItem, index);
    },

    /**
     * @param {string} id item id.
     * @return {number} the index of the cursor's current item in the list it
     * has checked out.
     */
    indexOfItemById: function(id) {
      var items = (this.list && this.list.items) || [];
      return array.indexOfGeneric(items, function(item) {
//TODO: done for search lists, can this be revisited?
        var other = 'message' in item ? item.message.id : item.id;
        return other === id;
      });
    },

    /**
     * Holds on to list and binds some events to it.
     * @param  {WindowedListView} list the new list.
     */
    bindToList: function(list) {
      this.release();

      this.list = list;
      this.list.on('seeked', this, 'onWinListSeeked');
      this.list.on('change', this, 'onWinListChange');
      this.list.on('syncComplete', this, 'onWinListSyncComplete');

//todo: once mail_app_logic thing worked out, the front_end can use a
//conv_churn with a height of 1 and then use seekInCoordinateSpace
console.log('LIST_CURSOR CALLING SEEKTOTOP 20, 20');
      list.seekToTop(20, 20);
    },

    onWinListSeeked: function(whatChanged) {
      // If there was a itemSuid expected and at the top, then
      // check to see if it was received. This is really just nice
      // for when a new item notification comes in, as the atTop
      // test is a bit fuzzy generally. Not all lists go to the top.
      if (this.list.atTop && this.expectingItemSuid &&
          this.list.items && this.list.items.length) {
        this.checkExpectingItemSuid(true);
      }

      this.emit('seeked', whatChanged);
    },

    onWinListChange: function() {
      this.emit.apply(this, ['change'].concat(Array.from(arguments)));
    },

    onWinListSyncComplete: function(data) {
      this.emit('syncComplete', data);
    },

//todo: remove/repurpose? How to know when an item is removed, and if it affects
//the currentItem choice?
    /**
     * Choose a new currentItem if we spilled the existing one.
     * Otherwise, emit 'currentItem' event to update stale listeners
     * in case we spilled a sibling.
     *
     * @param {MailMessage} removedMessage message that got removed.
     * @param {number} removedFromIndex index message was removed from.
     */
    onItemsSpliceRemove: function(removedMessage, removedFromIndex) {
      if (this.currentItem !== removedMessage) {
        // Emit 'currentItem' event in case we're spilling a sibling.
        return this.setCurrentItem(this.currentItem);
      }

      var items = this.list.items;
      if (items.length === 0) {
        // No more items... sad!
        return (this.currentItem = null);
      }

      var index = Math.min(removedFromIndex, items.length - 1);
      var item = this.list.items[index];
      this.setCurrentItem(item);
    },

    release: function() {
      if (this.list) {
        this.list.removeObjectListener(this);
        this.list.release();
        this.list = null;
      }

      this.currentItem = null;
    }
  });

  /**
   * @constructor
   * @param {Object} item.
   * @param {Object} siblings whether item has next and previous siblings.
   */
  function CurrentItem(item, siblings) {
    this.item = item;
    this.siblings = siblings;
  }

  CurrentItem.prototype = {
    /**
     * @type {MailMessage}
     */
    item: null,

    /**
     * Something like { hasPrevious: true, hasNext: false }.
     * @type {Object}
     */
    siblings: null
  };

  ListCursor.CurrentItem = CurrentItem;

  return ListCursor;
});
