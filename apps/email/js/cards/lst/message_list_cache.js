'use strict';
define(function(require) {

var htmlCache = require('html_cache'),
    VScroll = require('vscroll');

// Cache functions for message_list. Should not be used for other views, it
// is likely too specific to the message_list structure.
return {
  /**
   * How many items in the message list to keep for the _cacheDom call.
   * @type {Number}
   */
  _cacheListLimit: 7,

  /**
   * Tracks if a DOM cache save is scheduled for later.
   * @type {Number}
   */
  _cacheDomTimeoutId: 0,

  createdCallback: function() {
    this.usingCachedNode = this.dataset.cached === 'cached';
  },

  /**
   * Confirms card state is in a visual state suitable for caching.
   */
  _isCacheableCardState: function() {
    var model = this.model;
    return !this.editMode && model &&
           model.account.folders.getFirstFolderWithType('inbox').id ===
                                                              model.folder.id &&
           model.account === model.accounts.defaultAccount;
  },

  /**
   * Caches the DOM for this card, but trims it down a bit first.
   */
  _cacheDom: function(moduleId) {
    this._cacheDomTimeoutId = 0;
    if (!this._isCacheableCardState()) {
      return;
    }

    // Safely clone the node so we can mutate the tree to cut out the parts
    // we do not want/need.
    var cacheNode =
          htmlCache.cloneAsInertNodeAvoidingCustomElementHorrors(this);

    // Make sure toolbar is visible, could be hidden by drawer
    cacheNode.querySelector('menu[type="toolbar"]')
             .classList.remove('transparent');

    // Hide search field as it will not operate and gets scrolled out
    // of view after real load.
    var removableCacheNode = cacheNode.querySelector('lst-search-link');
    if (removableCacheNode) {
      removableCacheNode.classList.add('collapsed');
    }

    // Hide "new mail" topbar too
    removableCacheNode = cacheNode.querySelector('.message-list-topbar');
    if (removableCacheNode) {
      this.msgVScrollContainer.topBar.resetNodeForCache(removableCacheNode);
    }

    // Hide the last sync number
    var tempNode = cacheNode.querySelector('.msg-last-synced-label');
    if (tempNode) {
      tempNode.classList.add('collapsed');
    }
    tempNode = cacheNode.querySelector('.msg-last-synced-value');
    if (tempNode) {
      tempNode.innerHTML = '';
    }

    // Trim vScroll containers that are not in play
    VScroll.trimMessagesForCache(
      cacheNode.querySelector('.msg-vscroll-container'),
      this._cacheListLimit
    );

    htmlCache.saveFromNode(moduleId, cacheNode);
  },

  /**
   * Considers a DOM cache, but only if it meets the criteria for what
   * should be saved in the cache, and if a save is not already scheduled.
   * @param  {Number} index the index of the message that triggered
   *                  this call.
   */
  _considerCacheDom: function(index, moduleId) {
    // Only bother if not already waiting to update cache and
    if (!this._cacheDomTimeoutId &&
        // card visible state is appropriate
        this._isCacheableCardState() &&
        // if the scroll area is at the top (otherwise the
        // virtual scroll may be showing non-top messages)
        this.msgVScrollContainer.msgVScroll.vScroll.firstRenderedIndex === 0 &&
        // if actually got a numeric index and
        (index || index === 0) &&
        // if it affects the data we cache
        index < this._cacheListLimit) {
      this._cacheDomTimeoutId = setTimeout(this._cacheDom.bind(this, moduleId),
                                           600);
    }
  },

  /**
   * Clears out the messages HTML in messageContainer from using the cached
   * nodes that were picked up when the HTML cache of this list was used
   * (which is indicated by usingCachedNode being true). The cached HTML
   * needs to be purged when the real data is finally available and will
   * replace the cached state. A more sophisticated approach would be to
   * compare the cached HTML to what would be inserted in its place, and
   * if no changes, skip this step, but that comparison operation could get
   * tricky, and it is cleaner just to wipe it and start fresh. Once the
   * cached HTML has been cleared, then usingCachedNode is set to false
   * to indicate that the main piece of content in the card, the message
   * list, is no longer from a cached node.
   */
  _clearCachedMessages: function() {
    if (this.usingCachedNode) {
      this.msgVScrollContainer.msgVScroll.removeMessagesHtml();
      this.usingCachedNode = false;
    }
  }
};

});
