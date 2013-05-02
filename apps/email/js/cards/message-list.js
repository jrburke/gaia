/*global define, console, window, setTimeout */
define([
  'tmpl!./message-list.html',
  'tmpl!./msg/header-item.html',
  'tmpl!./msg/delete-confirm.html',
  'mail-common',
  'mail-app',
  'api',
  'l10n',
  'css!style/message-cards'
], function (templateNode, msgHeaderItemNode, deleteConfirmMsgNode,
   common, App, MailAPI, mozL10n) {

var Cards = common.Cards,
    Toaster = common.Toaster,
    ConfirmDialog = common.ConfirmDialog,
    batchAddClass = common.batchAddClass,
    bindContainerClickAndHold = common.bindContainerClickAndHold,
    bindContainerHandler = common.bindContainerHandler,
    appendMatchItemTo = common.appendMatchItemTo,
    displaySubject = common.displaySubject,
    prettyDate = common.prettyDate,
    isFirstLoad = true;

/**
 * Try and keep at least this many display heights worth of undisplayed
 * messages.
 */
var SCROLL_MIN_BUFFER_SCREENS = 2;
/**
 * Keep around at most this many display heights worth of undisplayed messages.
 */
var SCROLL_MAX_RETENTION_SCREENS = 7;

/**
 * Time to wait between scroll events. Initially 150 & 325 where tried but
 * because we wait between snippet requests 50 feels about right...
 */
var SCROLL_DELAY = 50;

/**
 * Minimum number of items there must be in the message slice
 * for us to attempt to limit the selection of snippets to fetch.
 */
var MINIMUM_ITEMS_FOR_SCROLL_CALC = 10;

/**
 * Maximum amount of time between issuing snippet requests.
 */
var MAXIMUM_MS_BETWEEN_SNIPPET_REQUEST = 6000;

/**
<<<<<<< HEAD:apps/email/js/cards/message-list.js
=======
 * Fetch up to 4kb while scrolling
 */
var MAXIMUM_BYTES_PER_MESSAGE_DURING_SCROLL = 4 * 1024;

/**
 * Format the message subject appropriately.  This means ensuring that if the
 * subject is empty, we use a placeholder string instead.
 *
 * @param {DOMElement} subjectNode the DOM node for the message's subject.
 * @param {Object} message the message object.
 */
function displaySubject(subjectNode, message) {
  var subject = message.subject && message.subject.trim();
  if (subject) {
    subjectNode.textContent = subject;
    subjectNode.classList.remove('msg-no-subject');
  }
  else {
    subjectNode.textContent = mozL10n.get('message-no-subject');
    subjectNode.classList.add('msg-no-subject');
  }
}

/**
>>>>>>> master:apps/email/js/message-cards.js
 * List messages for listing the contents of folders ('nonsearch' mode) and
 * searches ('search' mode).  Multi-editing is just a state of the card.
 *
 * Nonsearch and search modes exist together in the same card because so much
 * of what they do is the same.  We have the cards differ by marking nodes that
 * are not shared with 'msg-nonsearch-only' or 'msg-search-only'.  We add the
 * collapsed class to all of the nodes that are not applicable for a node at
 * startup.
 *
 * == Less-than-infinite scrolling ==
 *
 * A dream UI would be to let the user smoothly scroll through all of the
 * messages in a folder, syncing them from the server as-needed.  The limits
 * on this are 1) bandwidth cost, and 2) storage limitations.
 *
 * Our sync costs are A) initial sync of a time range, and B) update sync of a
 * time range.  #A is sufficiently expensive that it makes sense to prompt the
 * user when we are going to sync further into a time range.  #B is cheap
 * enough and having already synced the time range suggests sufficient user
 * interest.
 *
 * So the way our UI works is that we do an infinite-scroll-type thing for
 * messages that we already know about.  If we are on metered bandwidth, then
 * we require the user to click a button in the display list to sync more
 * messages.  If we are on unmetered bandwidth, we will eventually forego that.
 * (For testing purposes right now, we want to pretend everything is metered.)
 * We might still want to display a button at some storage threshold level,
 * like if the folder is already using a lot of space.
 *
 * See `onScroll` for more details.
 *
 * XXX this class wants to be cleaned up, badly.  A lot of this may want to
 * happen via pushing more of the hiding/showing logic out onto CSS, taking
 * care to use efficient selectors.
 */
function MessageListCard(domNode, mode, args) {
  this.domNode = domNode;
  this.mode = mode;
  this.scrollNode = domNode.getElementsByClassName('msg-list-scrollouter')[0];

  if (mode === 'nonsearch')
    batchAddClass(domNode, 'msg-search-only', 'collapsed');
  else
    batchAddClass(domNode, 'msg-nonsearch-only', 'collapsed');

  this.messagesContainer =
    domNode.getElementsByClassName('msg-messages-container')[0];

  this.messageEmptyContainer =
    domNode.getElementsByClassName('msg-list-empty-container')[0];
  // - message actions
  bindContainerClickAndHold(
    this.messagesContainer,
    // clicking shows the message reader for a message
    this.onClickMessage.bind(this),
    // press-and-hold shows the single-message mutation options
    this.onHoldMessage.bind(this));

  // - less-than-infinite scrolling
  this.scrollContainer =
    domNode.getElementsByClassName('msg-list-scrollouter')[0];
  this.scrollContainer.addEventListener('scroll', this.onScroll.bind(this),
                                        false);
  this.syncingNode =
    domNode.getElementsByClassName('msg-messages-syncing')[0];
  this.syncMoreNode =
    domNode.getElementsByClassName('msg-messages-sync-more')[0];
  this.syncMoreNode
    .addEventListener('click', this.onGetMoreMessages.bind(this), false);
  this.progressNode =
    domNode.getElementsByClassName('msg-list-progress')[0];
  // The active timeout that will cause us to set the progressbar to
  // indeterminate 'candybar' state when it fires.  Reset every time a new
  // progress notification is received.
  this.progressCandybarTimer = null;
  this._bound_onCandybarTimeout = this.onCandybarTimeout.bind(this);

  // - header buttons: non-edit mode
  domNode.getElementsByClassName('msg-folder-list-btn')[0]
    .addEventListener('click', this.onShowFolders.bind(this), false);
  domNode.getElementsByClassName('msg-compose-btn')[0]
    .addEventListener('click', this.onCompose.bind(this), false);

  // - toolbar: non-edit mode
  this.toolbar = {};
  this.toolbar.searchBtn = domNode.getElementsByClassName('msg-search-btn')[0];
  this.toolbar.searchBtn
    .addEventListener('click', this.onSearchButton.bind(this), false);
  this.toolbar.editBtn = domNode.getElementsByClassName('msg-edit-btn')[0];
  this.toolbar.editBtn
    .addEventListener('click', this.setEditMode.bind(this, true), false);
  this.toolbar.refreshBtn =
    domNode.getElementsByClassName('msg-refresh-btn')[0];
  this.toolbar.refreshBtn
    .addEventListener('click', this.onRefresh.bind(this), false);

  // - header buttons: edit mode
  domNode.getElementsByClassName('msg-listedit-cancel-btn')[0]
    .addEventListener('click', this.setEditMode.bind(this, false), false);

  // - toolbar: edit mode
  domNode.getElementsByClassName('msg-star-btn')[0]
    .addEventListener('click', this.onStarMessages.bind(this, true), false);
  domNode.getElementsByClassName('msg-mark-read-btn')[0]
    .addEventListener('click', this.onMarkMessagesRead.bind(this, true), false);
  domNode.getElementsByClassName('msg-delete-btn')[0]
    .addEventListener('click', this.onDeleteMessages.bind(this, true), false);
  this.toolbar.moveBtn = domNode.getElementsByClassName('msg-move-btn')[0];
  this.toolbar.moveBtn
    .addEventListener('click', this.onMoveMessages.bind(this, true), false);

  // -- non-search mode
  if (mode === 'nonsearch') {
    // - search teaser bar
    // Focusing the teaser bar's text field is the same as hitting the search
    // button.
    domNode.getElementsByClassName('msg-search-text-tease')[0]
      .addEventListener('focus', this.onSearchButton.bind(this), false);
  }
  // -- search mode
  else if (mode === 'search') {
    domNode.getElementsByClassName('msg-search-cancel')[0]
      .addEventListener('click', this.onCancelSearch.bind(this), false);

    bindContainerHandler(
      domNode.getElementsByClassName('filter')[0],
      'click', this.onSearchFilterClick.bind(this));
    this.searchInput = domNode.getElementsByClassName('msg-search-text')[0];
    this.searchInput.addEventListener(
      'input', this.onSearchTextChange.bind(this), false);
  }

  // convenience wrapper for context.
  this._onScroll = this._onScroll.bind(this);

  this.editMode = false;
  this.selectedMessages = null;

  this.curFolder = null;
  this.messagesSlice = null;
  this.isIncomingFolder = true;
  this._boundSliceRequestComplete = this.onSliceRequestComplete.bind(this);
  if (mode == 'nonsearch')
    this.showFolder(args.folder);
  else
    this.showSearch(args.folder, args.phrase || '', args.filter || 'all');
}
MessageListCard.prototype = {
  /**
   * How many milliseconds since our last progress update event before we put
   * the progressbar in the indeterminate "candybar" state?
   *
   * This value is currently arbitrarily chosen by asuth to try and avoid us
   * flipping back and forth from non-candybar state to candybar state
   * frequently.  This should be updated with UX or VD feedback.
   */
  PROGRESS_CANDYBAR_TIMEOUT_MS: 2000,

  postInsert: function() {
    this._hideSearchBoxByScrolling();

    if (this.mode === 'search')
      this.searchInput.focus();
  },

  onSearchButton: function() {
    Cards.pushCard(
      'message-list', 'search', 'animate',
      {
        folder: this.curFolder
      });
  },

  setEditMode: function(editMode) {
    var domNode = this.domNode;
    // XXX the manual DOM play here is now a bit overkill; we should very
    // probably switch top having the CSS do this for us or at least invest
    // some time in cleanup.
    var normalHeader = domNode.getElementsByClassName('msg-list-header')[0],
        searchHeader = domNode.getElementsByClassName('msg-search-header')[0],
        editHeader = domNode.getElementsByClassName('msg-listedit-header')[0],
        normalToolbar =
          domNode.getElementsByClassName('msg-list-action-toolbar')[0],
        editToolbar =
          domNode.getElementsByClassName('msg-listedit-action-toolbar')[0];

    this.editMode = editMode;

    if (editMode) {
      normalHeader.classList.add('collapsed');
      searchHeader.classList.add('collapsed');
      normalToolbar.classList.add('collapsed');
      editHeader.classList.remove('collapsed');
      editToolbar.classList.remove('collapsed');
      this.messagesContainer.classList.add('show-edit');

      this.selectedMessages = [];
      var cbs = this.messagesContainer.querySelectorAll('input[type=checkbox]');
      for (var i = 0; i < cbs.length; i++) {
        cbs[i].checked = false;
      }
      this.selectedMessagesUpdated();
    }
    else {
      if (this.mode === 'nonsearch')
        normalHeader.classList.remove('collapsed');
      else
        searchHeader.classList.remove('collapsed');
      normalToolbar.classList.remove('collapsed');
      editHeader.classList.add('collapsed');
      editToolbar.classList.add('collapsed');
      this.messagesContainer.classList.remove('show-edit');

      // (Do this based on the DOM nodes actually present; if the user has been
      // scrolling a lot, this.selectedMessages may contain messages that no
      // longer have a domNode around.)
      var selectedMsgNodes =
        domNode.getElementsByClassName('msg-header-item-selected');
      for (var i = selectedMsgNodes.length - 1; i >= 0; i--) {
        selectedMsgNodes[i].classList.remove('msg-header-item-selected');
      }

      this.selectedMessages = null;
    }

    // UXXX do we want to disable the buttons if nothing is selected?
  },

  /**
   * Update the edit mode UI bits sensitive to a change in the set of selected
   * messages.  This means: the label that says how many messages are selected,
   * whether the buttons are enabled, which of the toggle-pairs are visible.
   */
  selectedMessagesUpdated: function() {
    var headerNode =
      this.domNode.getElementsByClassName('msg-listedit-header-label')[0];
    headerNode.textContent =
      mozL10n.get('message-multiedit-header',
                  { n: this.selectedMessages.length });

    var starBtn = this.domNode.getElementsByClassName('msg-star-btn')[0],
        readBtn = this.domNode.getElementsByClassName('msg-mark-read-btn')[0];

    // Enabling/disabling rules (not UX-signed-off):  Our bias is that people
    // want to star messages and mark messages unread (since it they naturally
    // end up unread), so unless messages are all in this state, we assume that
    // is the desired action.
    var numStarred = 0, numRead = 0;
    for (var i = 0; i < this.selectedMessages.length; i++) {
      var msg = this.selectedMessages[i];
      if (msg.isStarred)
        numStarred++;
      if (msg.isRead)
        numRead++;
    }

    // Unstar if everything is starred, otherwise star
    this.setAsStarred = !(numStarred && numStarred ===
                          this.selectedMessages.length);
    // Mark read if everything is unread, otherwise unread
    this.setAsRead = (this.selectedMessages.length && numRead === 0);

    if (!this.setAsStarred)
      starBtn.classList.add('msg-btn-active');
    else
      starBtn.classList.remove('msg-btn-active');

    if (this.setAsRead)
      readBtn.classList.add('msg-btn-active');
    else
      readBtn.classList.remove('msg-btn-active');
  },

  _hideSearchBoxByScrolling: function() {
    // scroll the search bit out of the way
    var searchBar =
      this.domNode.getElementsByClassName('msg-search-tease-bar')[0];
    this.scrollNode.scrollTop = searchBar.offsetHeight;
  },

  onShowFolders: function() {
    Cards.moveToCard(['folder-picker', 'navigation']);
  },

  onCompose: function() {
    var composer = MailAPI.beginMessageComposition(null, this.curFolder, null,
      function composerReady() {
        Cards.pushCard('compose', 'default', 'animate',
                       { composer: composer });
      });
  },

  /**
   * Show a folder, returning true if we actually changed folders or false if
   * we did nothing because we were already in the folder.
   */
  showFolder: function(folder, forceNewSlice) {
    if (folder === this.curFolder && !forceNewSlice)
      return false;

    if (this.messagesSlice) {
      this.messagesSlice.die();
      this.messagesSlice = null;
      this.messagesContainer.innerHTML = '';
    }
    this.curFolder = folder;
    switch (folder.type) {
      case 'drafts':
      case 'localdrafts':
      case 'sent':
        this.isIncomingFolder = false;
        break;
      default:
        this.isIncomingFolder = true;
        break;
    }

    this.domNode.getElementsByClassName('msg-list-header-folder-label')[0]
      .textContent = folder.name;

    this.hideEmptyLayout();

    // you can't refresh the localdrafts folder or move messages out of it.
    if (folder.type === 'localdrafts') {
      this.toolbar.refreshBtn.classList.add('collapsed');
      this.toolbar.moveBtn.classList.add('collapsed');
    }
    else {
      this.toolbar.refreshBtn.classList.remove('collapsed');
      this.toolbar.moveBtn.classList.remove('collapsed');
    }

    // We are creating a new slice, so any pending snippet requests are moot.
    this._snippetRequestPending = false;
    this.messagesSlice = MailAPI.viewFolderMessages(folder);
    this.messagesSlice.onsplice = this.onMessagesSplice.bind(this);
    this.messagesSlice.onchange = this.updateMessageDom.bind(this, false);
    this.messagesSlice.onstatus = this.onStatusChange.bind(this);
    this.messagesSlice.oncomplete = this._boundSliceRequestComplete;
    return true;
  },

  showSearch: function(folder, phrase, filter) {
    console.log('sf: showSearch. phrase:', phrase, phrase.length);
    var tab = this.domNode.getElementsByClassName('filter')[0];
    var nodes = tab.getElementsByClassName('msg-search-filter');
    if (this.messagesSlice) {
      this.messagesSlice.die();
      this.messagesSlice = null;
      this.messagesContainer.innerHTML = '';
    }
    this.curFolder = folder;
    this.curPhrase = phrase;
    this.curFilter = filter;

    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].dataset.filter != this.curFilter) {
        nodes[i].setAttribute('aria-selected', 'false');
        continue;
      }
      nodes[i].setAttribute('aria-selected', 'true');
    }
    if (phrase.length < 1)
      return false;

    // We are creating a new slice, so any pending snippet requests are moot.
    this._snippetRequestPending = false;
    this.messagesSlice = MailAPI.searchFolderMessages(
      folder, phrase,
      {
        author: filter === 'all' || filter === 'author',
        recipients: filter === 'all' || filter === 'recipients',
        subject: filter === 'all' || filter === 'subject',
        body: filter === 'all' || filter === 'body'
      });
    this.messagesSlice.onsplice = this.onMessagesSplice.bind(this);
    this.messagesSlice.onchange = this.updateMatchedMessageDom.bind(this,
                                                                    false);
    this.messagesSlice.onstatus = this.onStatusChange.bind(this);
    this.messagesSlice.oncomplete = this._boundSliceRequestComplete;
    return true;
  },

  onSearchFilterClick: function(filterNode, event) {
    this.showSearch(this.curFolder, this.searchInput.value,
                    filterNode.dataset.filter);
  },

  onSearchTextChange: function(event) {
    console.log('sf: typed, now:', this.searchInput.value);
    this.showSearch(this.curFolder, this.searchInput.value, this.curFilter);
  },

  onCancelSearch: function(event) {
    try {
      if (this.messagesSlice)
        this.messagesSlice.die();
    }
    catch (ex) {
      console.error('problem killing slice:', ex, '\n', ex.stack);
    }
    this.messagesSlice = null;
    Cards.removeCardAndSuccessors(this.domNode, 'animate');
  },

  onGetMoreMessages: function() {
    this.messagesSlice.requestGrowth(1, true);
    // Provide instant feedback that they pressed the button by hiding the
    // button.  However, don't show 'synchronizing' because that might not
    // actually happen.
    this.syncMoreNode.classList.add('collapsed');
  },

  onStatusChange: function(newStatus) {
    switch (newStatus) {
      case 'synchronizing':
      case 'syncblocked':
        this.syncingNode.classList.remove('collapsed');
        this.syncMoreNode.classList.add('collapsed');
        this.hideEmptyLayout();

        this.progressNode.value = this.messagesSlice ?
                                  this.messagesSlice.syncProgress : 0;
        this.progressNode.classList.remove('pack-activity');
        this.progressNode.classList.remove('hidden');
        if (this.progressCandybarTimer)
          window.clearTimeout(this.progressCandybarTimer);
        this.progressCandybarTimer =
          window.setTimeout(this._bound_onCandybarTimeout,
                            this.PROGRESS_CANDYBAR_TIMEOUT_MS);
        break;
      case 'syncfailed':
        // If there was a problem talking to the server, notify the user and
        // provide a means to attempt to talk to the server again.  We have made
        // onRefresh pretty clever, so it can do all the legwork on
        // accomplishing this goal.
        Toaster.logRetryable(newStatus, this.onRefresh.bind(this));

        // Fall through...
      case 'synced':
        this.syncingNode.classList.add('collapsed');
        this.progressNode.classList.remove('pack-activity');
        this.progressNode.classList.add('hidden');
        if (this.progressCandybarTimer) {
          window.clearTimeout(this.progressCandybarTimer);
          this.progressCandybarTimer = null;
        }
        break;
    }
  },

  onCandybarTimeout: function() {
    if (this.progressCandybarTimer) {
      this.progressNode.classList.add('pack-activity');
      this.progressCandybarTimer = null;
    }
  },

  /**
   * Hide buttons that are not appropriate if we have no messages and display
   * the appropriate l10n string in the message list proper.
   */
  showEmptyLayout: function() {
    var text = this.domNode.
      getElementsByClassName('msg-list-empty-message-text')[0];
    text.textContent = this.mode == 'search' ?
      mozL10n.get('messages-search-empty') :
      mozL10n.get('messages-folder-empty');
    this.messageEmptyContainer.classList.remove('collapsed');
    this.toolbar.editBtn.classList.add('disabled');
    this.toolbar.searchBtn.classList.add('disabled');
    this._hideSearchBoxByScrolling();
  },
  /**
   * Show buttons we hid in `showEmptyLayout` and hide the "empty folder"
   * message.
   */
  hideEmptyLayout: function() {
    this.messageEmptyContainer.classList.add('collapsed');
    this.toolbar.editBtn.classList.remove('disabled');
    this.toolbar.searchBtn.classList.remove('disabled');
  },

  onSliceRequestComplete: function() {
    // We always want our logic to fire, but complete auto-clears before firing.
    this.messagesSlice.oncomplete = this._boundSliceRequestComplete;

    if (this.messagesSlice.userCanGrowDownwards)
      this.syncMoreNode.classList.remove('collapsed');
    else
      this.syncMoreNode.classList.add('collapsed');

    // Show empty layout, unless this is a slice with fake data that
    // will get changed soon.
    if (this.messagesSlice.items.length === 0 && !this.messagesSlice._fake) {
      this.showEmptyLayout();
    }
    // Consider requesting more data or discarding data based on scrolling that
    // has happened since we issued the request.  (While requests were pending,
    // onScroll ignored scroll events.)
    this._onScroll(null);
  },

  onScroll: function(evt) {
    if (this._pendingScrollEvent) {
      return;
    }

    this._pendingScrollEvent = true;
    this._scrollTimer = setTimeout(this._onScroll, SCROLL_DELAY, evt);
  },

  /**
   * Handle scrolling by requesting more messages when we have less than the
   * minimum buffer space and trimming messages when we have more than the max.
   *
   * We don't care about the direction of scrolling, which is helpful since this
   * also lets us handle cases where message deletion might have done bad things
   * to us.  (It does, however, open the door to foolishness where we request
   * data and then immediately discard some of it.)
   */
  _onScroll: function(event) {
    if (this._pendingScrollEvent) {
      this._pendingScrollEvent = false;
    }


    // Defer processing until any pending requests have completed;
    // `onSliceRequestComplete` will call us.
    if (!this.messagesSlice || this.messagesSlice.pendingRequestCount)
      return;

    if (!this._hasSnippetRequest()) {
      this._requestSnippets();
    }

    var curScrollTop = this.scrollContainer.scrollTop,
        viewHeight = this.scrollContainer.clientHeight;

    var preScreens = curScrollTop / viewHeight,
        postScreens = (this.scrollContainer.scrollHeight -
                       (curScrollTop + viewHeight)) /
                      viewHeight;

    var shrinkLowIncl = 0,
        shrinkHighIncl = this.messagesSlice.items.length - 1,
        messageNode = null, targOff;
    if (preScreens < SCROLL_MIN_BUFFER_SCREENS &&
        !this.messagesSlice.atTop) {
      this.messagesSlice.requestGrowth(-1);
      return;
    }
    else if (preScreens > SCROLL_MAX_RETENTION_SCREENS) {
      // Take off one screen at a time.
      targOff = curScrollTop -
                (viewHeight * (SCROLL_MAX_RETENTION_SCREENS - 1));
      for (messageNode = this.messagesContainer.firstElementChild;
           messageNode.offsetTop + messageNode.clientHeight < targOff;
           messageNode = messageNode.nextElementSibling) {
        shrinkLowIncl++;
      }
    }

    if (postScreens < SCROLL_MIN_BUFFER_SCREENS &&
        !this.messagesSlice.atBottom) {
      this.messagesSlice.requestGrowth(1);
    }
    else if (postScreens > SCROLL_MAX_RETENTION_SCREENS) {
      targOff = curScrollTop +
                this.scrollContainer.clientHeight +
                (viewHeight * (SCROLL_MAX_RETENTION_SCREENS - 1));
      for (messageNode = this.messagesContainer.lastElementChild;
           messageNode.offsetTop > targOff;
           messageNode = messageNode.previousElementSibling) {
        shrinkHighIncl--;
      }
    }

    if (shrinkLowIncl !== 0 ||
        shrinkHighIncl !== this.messagesSlice.items.length - 1) {
      this.messagesSlice.requestShrinkage(shrinkLowIncl, shrinkHighIncl);
    }

  },

  _hasSnippetRequest: function() {
    var max = MAXIMUM_MS_BETWEEN_SNIPPET_REQUEST;
    var now = Date.now();

    // if we before the maximum time to wait between requests...
    var beforeTimeout =
      (this._lastSnippetRequest + max) > now;

    // there is an important case where the backend may be slow OR have some
    // fatal error which would prevent us from ever requesting an new set of
    // snippets because we wait until the last batch finishes... To prevent that
    // from ever happening we maintain the request start time and if more then
    // MAXIMUM_MS_BETWEEN_SNIPPET_REQUEST passes we issue a new request.
    if (
      this._snippetRequestPending &&
      beforeTimeout
    ) {
      return true;
    }

    return false;
  },

  _pendingSnippetRequest: function() {
    this._snippetRequestPending = true;
    this._lastSnippetRequest = Date.now();
  },

  _clearSnippetRequest: function() {
    this._snippetRequestPending = false;
  },

  _requestSnippets: function() {
    var items = this.messagesSlice.items;
    var len = items.length;

    if (!len)
      return;

    var clearSnippets = this._clearSnippetRequest.bind(this);
    var options = {
      // this is per message
      maximumBytesToFetch: MAXIMUM_BYTES_PER_MESSAGE_DURING_SCROLL
    };

    if (len < MINIMUM_ITEMS_FOR_SCROLL_CALC) {
      this._pendingSnippetRequest();
      this.messagesSlice.maybeRequestBodies(0, 9, options, clearSnippets);
      return;
    }

    // get the scrollable offset
    if (!this._scrollContainerOffset) {
      this._scrollContainerRect =
        this.scrollContainer.getBoundingClientRect();
    }

    var constOffset = this._scrollContainerRect.top;

    // determine where we are in the list;
    var topOffset = (
      items[0].element.getBoundingClientRect().top - constOffset
    );

    // the distance between items. It is expected to remain fairly constant
    // throughout the list so we only need to calculate it once.

    var distance = this._distanceBetweenMessages;
    if (!distance) {
      this._distanceBetweenMessages = distance = Math.abs(
        topOffset -
        (items[1].element.getBoundingClientRect().top - constOffset)
      );
    }

    // starting offset to begin fetching snippets
    var startOffset = Math.floor(Math.abs(topOffset / distance));

    this._snippetsPerScrollTick = (
      this._snippetsPerScrollTick ||
      Math.ceil(this._scrollContainerRect.height / distance)
    );


    this._pendingSnippetRequest();
    this.messagesSlice.maybeRequestBodies(
      startOffset,
      startOffset + this._snippetsPerScrollTick,
      options,
      clearSnippets
    );

  },

  _fakeRemoveElements: [],

  onMessagesSplice: function(index, howMany, addedItems,
                             requested, moreExpected, fake) {
    // If no work to do, just skip it. This is particularly important during
    // the fake to real transition, where an empty onMessagesSplice is sent.
    // If this return is not done, there is a flicker in the message list
    if (index === 0 && howMany === 0 && !addedItems.length)
      return;

    if (this._fakeRemoveElements.length) {
      this._fakeRemoveElements.forEach(function(element) {
        element.parentNode.removeChild(element);
      });
      this._fakeRemoveElements = [];
    }

    var prevHeight;
    // - removed messages
    if (howMany) {
      if (fake && index === 0 && this.messagesSlice.items.length === howMany &&
          !addedItems.length) {
        // If this is a call to remove the fake data, hold onto it until the
        // next splice call, to avoid flickering.
        this._fakeRemoveElements = this.messagesSlice.items.map(
              function(item) { return item.element; });
      } else {
        // Regular remove for current call.
        // Plan to fixup the scroll position if we are deleting a message that
        // starts before the (visible) scrolled area.  (We add the container's
        // start offset because it is as big as the occluding header bar.)
        var prevHeight = null;
        if (this.messagesSlice.items[index].element.offsetTop <
            this.scrollContainer.scrollTop + this.messagesContainer.offsetTop) {
          prevHeight = this.messagesContainer.clientHeight;
        }

        for (var i = index + howMany - 1; i >= index; i--) {
          var message = this.messagesSlice.items[i];
          message.element.parentNode.removeChild(message.element);
        }

        // If fixup is requred, adjust.
        if (prevHeight !== null) {
          this.scrollContainer.scrollTop -=
            (prevHeight - this.messagesContainer.clientHeight);
        }

        // Check the message count after deletion:
        if (this.messagesContainer.children.length === 0) {
          this.showEmptyLayout();
        }
      }
    }

    // - added/existing
    var insertBuddy, self = this;
    if (index >= this.messagesContainer.childElementCount)
      insertBuddy = null;
    else
      insertBuddy = this.messagesContainer.children[index];
    if (insertBuddy &&
        (insertBuddy.offsetTop <
         this.scrollContainer.scrollTop + this.messagesContainer.offsetTop))
      prevHeight = this.messagesContainer.clientHeight;
    else
      prevHeight = null;

    // Remove the no message text while new messages added:
    if (addedItems.length > 0) {
      this.hideEmptyLayout();
    }

    addedItems.forEach(function(message) {
      var domMessage;
      domMessage = message.element = msgHeaderItemNode.cloneNode(true);

      if (self.mode === 'nonsearch') {
        domMessage.message = message;
        self.updateMessageDom(true, message);
      }
      else {
        domMessage.message = message.header;
        self.updateMatchedMessageDom(true, message);
      }

      self.messagesContainer.insertBefore(domMessage, insertBuddy);
    });

    if (prevHeight) {
      this.scrollContainer.scrollTop +=
        (this.messagesContainer.clientHeight - prevHeight);
    }
  },

  updateMessageDom: function(firstTime, message) {
    var msgNode = message.element;

    // some things only need to be done once
    var dateNode = msgNode.getElementsByClassName('msg-header-date')[0];
    if (firstTime) {
      var listPerson;
      if (this.isIncomingFolder)
        listPerson = message.author;
      // XXX This is not to UX spec, but this is a stop-gap and that would
      // require adding strings which we cannot justify as a slipstream fix.
      else if (message.to && message.to.length)
        listPerson = message.to[0];
      else if (message.cc && message.cc.length)
        listPerson = message.cc[0];
      else if (message.bcc && message.bcc.length)
        listPerson = message.bcc[0];
      else
        listPerson = message.author;

      // author
      msgNode.getElementsByClassName('msg-header-author')[0]
        .textContent = listPerson.name || listPerson.address;
      // date
      dateNode.dataset.time = message.date.valueOf();
      dateNode.textContent = prettyDate(message.date);
      // subject
      displaySubject(msgNode.getElementsByClassName('msg-header-subject')[0],
                     message);
      // attachments
      if (message.hasAttachments)
        msgNode.getElementsByClassName('msg-header-attachments')[0]
          .classList.add('msg-header-attachments-yes');
    }

    // snippet
    msgNode.getElementsByClassName('msg-header-snippet')[0]
      .textContent = message.snippet;

    // unread (we use very specific classes directly on the nodes rather than
    // child selectors for hypothetical speed)
    var unreadNode =
      msgNode.getElementsByClassName('msg-header-unread-section')[0];
    if (message.isRead) {
      unreadNode.classList.remove('msg-header-unread-section-unread');
      dateNode.classList.remove('msg-header-date-unread');
    }
    else {
      unreadNode.classList.add('msg-header-unread-section-unread');
      dateNode.classList.add('msg-header-date-unread');
    }
    // star
    var starNode = msgNode.getElementsByClassName('msg-header-star')[0];
    if (message.isStarred)
      starNode.classList.add('msg-header-star-starred');
    else
      starNode.classList.remove('msg-header-star-starred');

    // Send hacky appRendered if this is the first time.
    if (isFirstLoad) {
      isFirstLoad = false;
      window.location.replace('#x-moz-perf-user-ready');
    }
  },

  updateMatchedMessageDom: function(firstTime, matchedHeader) {
    var msgNode = matchedHeader.element,
        matches = matchedHeader.matches,
        message = matchedHeader.header;

    // some things only need to be done once
    var dateNode = msgNode.getElementsByClassName('msg-header-date')[0];
    if (firstTime) {
      // author
      var authorNode = msgNode.getElementsByClassName('msg-header-author')[0];
      if (matches.author)
        appendMatchItemTo(matches.author, authorNode);
      else
        authorNode.textContent = message.author.name || message.author.address;

      // date
      dateNode.dataset.time = message.date.valueOf();
      dateNode.textContent = prettyDate(message.date);

      // subject
      var subjectNode = msgNode.getElementsByClassName('msg-header-subject')[0];
      if (matches.subject)
        appendMatchItemTo(matches.subject[0], subjectNode);
      else
        displaySubject(subjectNode, message);

      // snippet
      var snippetNode = msgNode.getElementsByClassName('msg-header-snippet')[0];
      if (matches.body)
       appendMatchItemTo(matches.body[0], snippetNode);
      else
        snippetNode.textContent = message.snippet;

      // attachments
      if (message.hasAttachments)
        msgNode.getElementsByClassName('msg-header-attachments')[0]
          .classList.add('msg-header-attachments-yes');
    }

    // unread (we use very specific classes directly on the nodes rather than
    // child selectors for hypothetical speed)
    var unreadNode =
      msgNode.getElementsByClassName('msg-header-unread-section')[0];
    if (message.isRead) {
      unreadNode.classList.remove('msg-header-unread-section-unread');
      dateNode.classList.remove('msg-header-date-unread');
    }
    else {
      unreadNode.classList.add('msg-header-unread-section-unread');
      dateNode.classList.add('msg-header-date-unread');
    }
    // star
    var starNode = msgNode.getElementsByClassName('msg-header-star')[0];
    if (message.isStarred)
      starNode.classList.add('msg-header-star-starred');
    else
      starNode.classList.remove('msg-header-star-starred');
  },

  onClickMessage: function(messageNode, event) {
    var header = messageNode.message;
    if (this.editMode) {
      var idx = this.selectedMessages.indexOf(header);
      var cb = messageNode.querySelector('input[type=checkbox]');
      if (idx !== -1) {
        this.selectedMessages.splice(idx, 1);
        cb.checked = false;
      }
      else {
        this.selectedMessages.push(header);
        cb.checked = true;
      }
      this.selectedMessagesUpdated();
      return;
    }

    if (this.curFolder.type === 'localdrafts') {
      var composer = header.editAsDraft(function() {
        Cards.pushCard('compose', 'default', 'animate',
                       { composer: composer });
      });
      return;
    }

    Cards.pushCard(
      'message-reader', 'default', 'animate',
      {
        header: header
      });
  },

  onHoldMessage: function(messageNode, event) {
    this.setEditMode(true);
  },

  onRefresh: function() {
    switch (this.messagesSlice.status) {
      // If we're still synchronizing, then the user is not well served by
      // queueing a refresh yet, let's just squash this.
      case 'new':
      case 'synchronizing':
        break;
      // If we fully synchronized, then yes, let us refresh.
      case 'synced':
        this.messagesSlice.refresh();
        break;
      // If we failed to talk to the server, then let's only do a refresh if we
      // know about any messages.  Otherwise let's just create a new slice by
      // forcing reentry into the folder.
      case 'syncfailed':
        if (this.messagesSlice.items.length)
          this.messagesSlice.refresh();
        else
          this.showFolder(this.curFolder, /* force new slice */ true);
        break;
    }
  },

  onStarMessages: function() {
    var op = MailAPI.markMessagesStarred(this.selectedMessages,
                                         this.setAsStarred);
    this.setEditMode(false);
    Toaster.logMutation(op);
  },

  onMarkMessagesRead: function() {
    var op = MailAPI.markMessagesRead(this.selectedMessages, this.setAsRead);
    this.setEditMode(false);
    Toaster.logMutation(op);
  },

  onDeleteMessages: function() {
    // TODO: Batch delete back-end mail api is not ready for IMAP now.
    //       Please verify this function under IMAP when api completed.

    if (this.selectedMessages.length === 0)
      return;

    var dialog = deleteConfirmMsgNode.cloneNode(true);
    var content = dialog.getElementsByTagName('p')[0];
    content.textContent = mozL10n.get('message-multiedit-delete-confirm',
                                      { n: this.selectedMessages.length });
    ConfirmDialog.show(dialog,
      { // Confirm
        id: 'msg-delete-ok',
        handler: function() {
          var op = MailAPI.deleteMessages(this.selectedMessages);
          Toaster.logMutation(op);
          this.setEditMode(false);
        }.bind(this)
      },
      { // Cancel
        id: 'msg-delete-cancel',
        handler: null
      }
    );
  },

  onMoveMessages: function() {
    // TODO: Batch move back-end mail api is not ready now.
    //       Please verify this function when api landed.
    Cards.folderSelector(function(folder) {
      var op = MailAPI.moveMessages(this.selectedMessages, folder);
      Toaster.logMutation(op);
      this.setEditMode(false);
    }.bind(this));
  },

  /**
   * The folder picker is telling us to change the folder we are showing.
   */
  told: function(args) {
    if (this.showFolder(args.folder)) {
      this._hideSearchBoxByScrolling();
    }
  },

  die: function() {
    if (this.messagesSlice) {
      this.messagesSlice.die();
      this.messagesSlice = null;
    }
  }
};
Cards.defineCard({
  name: 'message-list',
  modes: {
    nonsearch: {
      tray: false
    },
    search: {
      tray: false
    }
  },
  constructor: MessageListCard,
  templateNode: templateNode
});

});
