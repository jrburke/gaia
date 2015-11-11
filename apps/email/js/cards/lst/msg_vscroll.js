'use strict';

define(function(require, exports) {

var cards = require('cards'),
    containerListen = require('container_listen'),
    mozL10n = require('l10n!'),
    msgMessageItemNode = require('tmpl!../msg/message_item.html'),
    VScroll = require('vscroll');

/**
 * Component that shows a message-based vscroll. Assumes the following are set
 * on the this component before vscroll is active:
 * - listCursor
 */
return [
  require('../base')(require('template!./msg_vscroll.html')),
  {
    createdCallback: function() {
//todo: remove this long term if gelam supports knowing this on the list itself.
      this.listIsGrowing = false;
      this.listGrowComplete = null;

      this.setAttribute('role', 'listbox');
      this.setAttribute('aria-multiselectable', 'true');

      this.onCurrentMessage = this.onCurrentMessage.bind(this);

      mozL10n.setAttributes(this.messageEmptyText, this.dataset.emptyL10nId);

      containerListen(this.vScrollContainer, 'click',
                      this.onClickMessage.bind(this));
    },

    /**
     * Call this from the createdCallback of the module that wants to display
     * a message-based vscroll.
     */
    init: function(scrollContainer, bindData,
                   defaultVScrollData, templateNode) {
      this.scrollContainer = scrollContainer;

      // Set up the list data source for VScroll
      var listFunc = (index) => {
         return this.listCursor.list.items[index];
      };

      listFunc.size = () => {
        // This method could get called during VScroll updates triggered
        // by winList_seeked. However at that point, the totalCount may
        // not be correct, like when fetching more messages from the
        // server. So approximate by using the size of slice.items.
        var slice = this.listCursor.list;
        // coerce totalCount to 0 if it was undefined to avoid a NaN
        return Math.max(slice.totalCount || 0, slice.items.length);
      };
      this.listFunc = listFunc;

      // We need to wait for the slice to complete before we can issue any
      // sensible growth requests.
      this.waitingOnChunk = true;
      this._loadNextChunkArgs = null;
      this._needVScrollData = false;
      this.vScroll = new VScroll(
        this.vScrollContainer,
        this.scrollContainer,
        templateNode || msgMessageItemNode,
        defaultVScrollData
      );

      // Called by VScroll wants to bind some data to a node it wants to
      // display in the DOM.
      this.vScroll.bindData = bindData;

      // Called by VScroll when it detects it will need more data in the near
      // future. VScroll does not know if it already asked for this
      // information, so this function needs to be sure it actually needs to
      // ask for more from the back end.
      this.vScroll.prepareData =
                         (highAbsoluteIndex, prerenderCount) => {
        var listCursor = this.listCursor,
            totalCount = listCursor.list.totalCount;

        if (!listCursor.list.items || !totalCount) {
          return;
        }

        // Make sure total amount stays within possible range.
        if (highAbsoluteIndex > totalCount - 1) {
          highAbsoluteIndex = totalCount - 1;
        } else if (highAbsoluteIndex < 0) {
          highAbsoluteIndex = 0;
        }

        this.loadNextChunk(highAbsoluteIndex, prerenderCount);
      };

      // Find the containing element that is a card, for use when asking if that
      // card is visible and extra work should be done.
      var parent = this;
      while((parent = parent.parentNode)) {
        if (parent.classList.contains('card')) {
          break;
        }
      }
      this.cardParent = parent;

      this.vScroll.on('scrollStopped', this, '_onVScrollStopped');
    },

    setListCursor: function(listCursor, model) {
      this.releaseFromListCursor();

      this.listIsGrowing = false;
      if (this.listGrowComplete) {
        this.listCursor.list.removeListener(this.listGrowComplete);
      }


      if (this.listCursor) {
        this.listCursor.removeObjectListener(this);
      }
      this.listCursor = listCursor;

      listCursor.on('change', this, 'onWinListChange');
      listCursor.on('seeked', this, 'onWinListSeeked');
      listCursor.on('currentItem', this, 'onCurrentMessage');

      if (this.model) {
        this.model.removeObjectListener(this);
      }
      this.model = model;
      model.on('folderUpdated', this, 'onListGrowChange');
    },

    /**
     * Used to remove the cached HTML from a cache restore of HTML. Do not use
     * this for clearing the display of messages when the list of messages
     * change, instead use methods on the vScroll object.
     */
    removeMessagesHtml: function() {
      this.vScrollContainer.innerHTML = '';
    },

    onClickMessage: function(node, event) {
      this.emitDomEvent('messageClick', node);
    },

    /**
     * Waits for scrolling to stop before fetching snippets.
     */
    _onVScrollStopped: function() {
      // Give any pending requests in the slice priority.
      if (!this.listCursor || !this.listCursor.list) {
        return;
      }

      // Do not bother fetching snippets if this card is not in view.
      // The card could still have a scroll event triggered though
      // by the next/previous work done in message_reader.
      if (cards.isVisible(this.cardParent)) {
        this._requestSnippets();
      }
    },

    onGetMoreMessages: function() {
      if (!this.listCursor.list) {
        return;
      }

      // For accessibility purposes, focus on the first newly loaded item in the
      // messages list. This will ensure that screen reader's cursor position
      // will get updated to the right place.
      this.vScroll.once('recalculated', (calledFromTop, refIndex) => {
        // refIndex is the index of the first new message item.
        this.vScrollContainer.querySelector(
          '[data-index="' + refIndex + '"]').focus();
      });

//todo: check this is correct.
      this.listIsGrowing = true;
      this.emit('listGrowChange', this.listIsGrowing);

      if (this.listGrowComplete) {
        this.listCursor.list.removeListener(this.listGrowComplete);
      }

      this.listGrowComplete = () => {
        this.listIsGrowing = false;
        this.emit('listGrowChange', this.listIsGrowing);
      };

      this.listCursor.list.once('complete', this.listGrowComplete);
      this.listCursor.list.grow();
    },

    isEmpty: function() {
      return this.listCursor.list.items.length === 0;
    },

    /**
     * Hide buttons that are not appropriate if we have no messages and display
     * the appropriate l10n string in the message list proper.
     */
    showEmptyLayout: function() {
      this.messageEmptyContainer.classList.remove('collapsed');
      this.emit('emptyLayoutShown');
    },
    /**
     * Show buttons we hid in `showEmptyLayout` and hide the "empty folder"
     * message.
     */
    hideEmptyLayout: function() {
      this.messageEmptyContainer.classList.add('collapsed');
      this.emit('emptyLayoutHidden');
    },

//todo: revisit once syncBlocked available, and when grow state goes elsewhere.
    onListGrowChange: function() {
      var syncStatus = this.model && this.model.folder &&
                       this.model.folder.syncStatus;


      var syncInProgress = syncStatus === 'pending' ||
                           status === 'active' || this.listIsGrowing;

      if (syncInProgress) {
          this.syncingNode.classList.remove('collapsed');
          this.syncMoreNode.classList.add('collapsed');
          this.hideEmptyLayout();
      } else {
        //todo: redo once syncBlocked is available.
        // if (newStatus === 'syncfailed') {
          // If there was a problem talking to the server, notify the user and
          // provide a means to attempt to talk to the server again.  We have
          // made onRefresh pretty clever, so it can do all the legwork on
          // accomplishing this goal.
        //   toaster.toast({
        //     text: mozL10n.get('toaster-retryable-syncfailed')
        //   });
        // }
        this.syncingNode.classList.add('collapsed');

        //todo: consider case where syncing is to the end of the folder.
        this.syncMoreNode.classList.remove('collapsed');

        //todo: Also trigger snippets, may go away once default syncing of n new
        // messages includes snippets.
        this._requestSnippets();
      }
    },

    onWinListChange: function() {
      // If the list cursor's list has changed, it could be for length reasons.
//todo: need to revisit, distinguish between cangrow and count, once backend has
//those properties.
      if (this.listCursor.list.totalCount) {
        this.hideEmptyLayout();
      } else {
        this.showEmptyLayout();
      }
      // Show "load more", but only if the slice can grow and if there is a
      // non-zero totalCount. If zero totalCount, it likely means the folder
      // has never been synchronized, and this display was an offline display,
      // so it is hard to know if messages can be synchronized. In this case,
      // canGrow is not enough of an indicator, because as far as the back end
      // is concerned, it could grow, it just has no way to check for sure yet.
      // So hide the "load more", the user can use the refresh icon once online
      // to load messages.
      // if (listCursor.list.atBottom &&
      //     listCursor.list.totalCount) {
      //   this.syncMoreNode.classList.remove('collapsed');
      // } else {
      //   this.syncMoreNode.classList.add('collapsed');
      // }

//todo: maybe newEmailCount comes through this channel? Hmm, may be confusing
//with a total unread count?
    },

    // A listener for list 'seek' events in the list cursor.
    onWinListSeeked: function(whatChanged) {
      var list = this.listCursor.list,
          index = list.offset,
          items = list.items;

      this.waitingOnChunk = false;
      // Load next chunk if one is pending
      if (this._loadNextChunkArgs) {
        this.loadNextChunk.apply(this, this._loadNextChunkArgs);
        this._loadNextChunkArgs = null;
      }

      if (!items[0]) {
        // No data, return.
        return;
      }

      console.log('MSG_VSCROLL onWinListSeeked: ' +
                  items.length + ' at ' + index);

      this.emit('messagesSpliceStart', whatChanged);

      if (this._needVScrollData) {
        this.vScroll.setData(this.listFunc);
        this._needVScrollData = false;
      }

      this.vScroll.updateDataBind(index, items, 0);

      this.emit('messagesSpliceEnd', whatChanged);
    },

//todo: what to do here?
    // The funny name because it is auto-bound as a listener for
    // list events in listCursor using a naming convention.
    messages_change: function(message, index) {
      this.emit('messagesChange', message, index);
    },

    /**
     * Request data through desiredHighAbsoluteIndex if we don't have it
     * already and we think it exists.  If we already have an outstanding
     * request we will save off this most recent request to process once
     * the current request completes.  Any previously queued request will
     * be forgotten regardless of how it compares to the newly queued
     * request.
     *
     * @param  {Number} desiredHighAbsoluteIndex
     */
    loadNextChunk: function(desiredHighAbsoluteIndex, prerenderCount) {
      // The recalculate logic will trigger a call to prepareData, so
      // it's okay for us to bail.  It's advisable for us to bail
      // because any calls to prepareData will be based on outdated
      // index information.
      if (this.vScroll.waitingForRecalculate) {
        return;
      }

      if (this.waitingOnChunk) {
        this._loadNextChunkArgs =
                      [desiredHighAbsoluteIndex, prerenderCount];
        return;
      }

      // Do not bother asking for more than exists
      var listCursor = this.listCursor,
          offset = listCursor.list.offset,
          items = listCursor.list.items,
          totalCount = listCursor.list.totalCount;

      if (desiredHighAbsoluteIndex >= totalCount ||
          // Already have enough data prepped, no need to seek.
          (desiredHighAbsoluteIndex >= offset &&
          desiredHighAbsoluteIndex <= offset + items.length)) {
        return;
      }

      var amount = prerenderCount * 2;

      console.log('message_list loadNextChunk seeking to',
                   desiredHighAbsoluteIndex,
                  'prerenderCount:', prerenderCount,
                  'items out of', totalCount, 'alleged known');

      listCursor.list.seekFocusedOnAbsoluteIndex(desiredHighAbsoluteIndex,
              amount, amount, amount, amount);
      this.waitingOnChunk = true;
    },

    /**
     * Scroll to make sure that the current message is in our visible window.
     *
     * @param {list_cursor.CurrentMessage} currentMessage representation of
     *     the email we're currently reading.
     * @param {Number} index the index of the message in the list
     */
    onCurrentMessage: function(currentMessage, index) {
      if (!currentMessage) {
        return;
      }

      var visibleIndices = this.vScroll.getVisibleIndexRange();
      if (visibleIndices &&
          (index < visibleIndices[0] || index > visibleIndices[1])) {
        this.vScroll.jumpToIndex(index);
      }
    },

    _requestSnippets: function() {
      this.listCursor.list.ensureSnippets();
    },

    releaseFromListCursor: function() {
      if (this.listCursor) {
        this.listCursor.removeObjectListener(this);
      }
    },

    release: function() {
      if (this.model) {
        this.model.removeObjectListener(this);
      }
      this.releaseFromListCursor();
      this.vScroll.destroy();
    }
  }
];

});
