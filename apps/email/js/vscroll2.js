// Based on bkelly's 'virtual-list-demo' code
/*global requestAnimationFrame */
'use strict';

define(function() {

  function VScroll(scrolledChild, scrollEventNode, list, template,
                   defaultData) {
    this.scrolledChild = scrolledChild;
    this.scrollEventNode = scrollEventNode;
    this.list = list;
    this.template = template;
    this.defaultData = defaultData;

    // Indexed by item number, the item elements currently in the DOM.
    this._itemsInDOM = [];
    this._itemsBeingPrepared = [];
    this._itemsAlreadyPrepared = [];

    // Init our _lastScrollPos to be slightly off from starting position to
    // force initial render.
    this._lastScrollPos = this.getScrollPos() - 1;

    this._forceGenerateItems = false;

    this._generateItemsScheduled = false;

    this._eventHandlersEnabled = false;

    // Bind to this to make reuse in functional APIs easier.
    this._scheduleGenerateItems = this._scheduleGenerateItems.bind(this);
  }

  VScroll.prototype = {

    // Tune the multiplier according to how much time it takes to prepare items
    // to populate the DOM. If you have a slow DB lookup, increase the value. If
    // you have everything immediately available, you can decrease it probably
    // as far down as 0.5.
    displayPortMarginMultiplier: 1.5,

    // 6 px/ms max velocity * 16 ms/frame = 96 px/frame
    // 480 px/screen / 96 px/frame = 5 frames/screen
    // So we only need to do work every 5th frame.  If we could get the max
    // velocity pref we could calculate this.
    MAX_SKIPPED_FRAMES: 4,

    _skippedFrames: 4,

    init: function() {
      if (this._inited) {
        return;
      }

      // Expected to be provided by app code:
      //  * DOM element with id='template' with fixed height
      //  * numItems variable
      //  * displayPortMarginMultiplier variable
      //  * scrolledChild variable
      //  * scrollEventNode variable
      //  * prepareItemModel(index, callback) function
      //  * cancelItem(index) function
      //  * populateItem(element, model) function

      this.itemHeight = this.template.clientHeight;
      // The template should not be rendered, so take it out of the document.
      this.template.parentNode.removeChild(this.template);

      this.calculateTotalHeight();

      this._inited = true;
    },

    calculateTotalHeight: function(runRender) {
      // Size the scrollable area to the full height if all items
      // were rendered inside of it, so that there is no weird
      // scroll bar grow/shrink effects and so that inertia
      // scrolling is not artificially truncated.
      var newListSize = this.list.size();
      if (this.oldListSize !== newListSize) {
        this.totalHeight = this.itemHeight * this.list.size();
        this.scrolledChild.style.height = this.totalHeight + 'px';
        this.oldListSize = newListSize;

        if (runRender) {
          this._scheduleGenerateItems();
        }
      }
    },

    clearDisplay: function() {
      this.scrolledChild.innerHTML = '';
      this.scrolledChild.style.height = '0px';
      this._cleared = true;
    },

    setData: function(list) {
      this.list = list;
      if (this._inited) {
        this.calculateTotalHeight(true);
      }
    },

    _itemPrepared: function(index, success) {
      if (!this._itemsBeingPrepared[index]) {
        this.cancelItem(index);
        return;
      }
      delete this._itemsBeingPrepared[index];
      if (success) {
        this._itemsAlreadyPrepared[index] = true;
        this._forceGenerateItems = true;
        this._scheduleGenerateItems();
      }
    },

    _scheduleGenerateItems: function() {
      if (this._generateItemsScheduled) {
        return;
      }
      this._generateItemsScheduled = true;
      // Disable events as we will monitor scroll position manually every frame
      this._disableEventHandlers();
      requestAnimationFrame(this._generateItems);
    },

    _generateItems: function() {
      this._generateItemsScheduled = false;

      // As described above we only need to do work every N frames.
      // TODO: It would be nice to spread work across all these frames instead
      //       of bursting every Nth frame.  Have to weigh complexity costs
      //       there.
      if (this._skippedFrames < this.MAX_SKIPPED_FRAMES &&
          !this._forceGenerateItems) {
        this._skippedFrames += 1;
        this._scheduleGenerateItems();
      }
      this._skippedFrames = 0;

      var i,
          scrollPos = this.getScrollPos();

      // If we stopped scrolling then go back to passive mode and wait for a new
      // scroll to start.
      if (scrollPos === this._lastScrollPos && !this._forceGenerateItems) {
        this._skippedFrames = this.MAX_SKIPPED_FRAMES;
        this._enableEventHandlers();
        return;
      }

      var scrollingForward = scrollPos >= this._lastScrollPos;

      this._forceGenerateItems = false;

      var scrollPortHeight = this.getScrollPortHeight();
      // Determine which items we *need* to have in the DOM. displayPortMargin
      // is somewhat arbitrary. If there is fast async scrolling, increase
      // displayPortMarginMultiplier to make sure more items can be prerendered.
      // IF populateItem triggers slow async activity (e.g. image loading or
      // database queries to fill in an item), increase
      // displayPortMarginMultiplier to reduce the likelihood of the user
      // seeing incomplete items.
      var displayPortMargin = this.displayPortMarginMultiplier *
                              scrollPortHeight;
      var startIndex = Math.max(0,
        Math.floor((this.scrollPos - displayPortMargin) /
                    this.itemHeight));
      var endIndex = Math.min(this.list.size(),
        Math.ceil((this.scrollPos + scrollPortHeight +
                   displayPortMargin) / this.itemHeight));

      for (i in this._itemsBeingPrepared) {
        if (i < startIndex || i >= endIndex) {
          delete this._itemsBeingPrepared[i];
        }
      }

      for (i in this._itemsAlreadyPrepared) {
        if (i < startIndex || i >= endIndex) {
          delete this._itemsAlreadyPrepared[i];
          this.cancelItem(i);
        }
      }

      // indices of items which are eligible for recycling
      var recyclableItems = [];
      for (i in this._itemsInDOM) {
        if (i < startIndex || i >= endIndex) {
          recyclableItems.push(i);
        }
      }
      recyclableItems.sort();


      var toAppend = [];
      for (i = startIndex; i < endIndex; ++i) {
        if (this._itemsInDOM[i]) {
          continue;
        } else if (this._itemsBeingPrepared[i]) {
          continue;
        } else if (!this._itemsAlreadyPrepared[i]) {
          this._itemsBeingPrepared[i] = true;
          this.prepareItemModel(i, this._itemPrepared);
          continue;
        }

        delete this._itemsAlreadyPrepared[i];
        var item;
        if (recyclableItems.length > 0) {
          var recycleIndex;
          // Delete the item furthest from the direction we're scrolling toward
          if (scrollingForward) {
            recycleIndex = recyclableItems.shift();
          } else {
            recycleIndex = recyclableItems.pop();
          }
          item = this._itemsInDOM[recycleIndex];
          delete this._itemsInDOM[recycleIndex];

          // NOTE: We must detach and reattach the node even though we are
          //       essentially just repositioning it.  This avoid pathological
          //       layerization behavior where each item gets assigned its own
          //       layer.
          this.scrolledChild.removeChild(item);
        } else {
          item = this.template.cloneNode(true);
        }
        if (!this.populateItem(item, (this.list(i) || this.defaultData))) {
          // failed to populate, so discard node unfortunately
          continue;
        }
        item.style.top = i * this.itemHeight + 'px';
        this._itemsInDOM[i] = item;
        toAppend.push(item);
      }

      if (toAppend.length === 1) {
        this.scrolledChild.appendChild(toAppend.shift());
      } else if (toAppend.length) {
        var frag = document.createDocumentFragment();
        while (toAppend.length) {
          frag.appendChild(toAppend.shift());
        }
        this.scrolledChild.appendChild(frag);
      }

      this._lastScrollPos = scrollPos;

      // Continue checking every animation frame until we see that we have
      // stopped scrolling.
      this._scheduleGenerateItems();
    },

    // Change this function to control what gets created for each item.
    // 'element' is a copy of the template element (which may have been
    // previously used with another index, so make sure you reset any contents
    // which may have been set by a previous call to populateItem).
    // You could do almost anything you want here. You could even dynamically
    // create additional child elements (but don't forget to remove them when
    // the element is reused for another index). You could make fields editable,
    // or load images, etc etc etc.
    // In a more realistic example, this would fetch data from an in-memory
    // database. Or, you could replace the item fields with placeholders (e.g.
    // 'loading...'), issue an async database query to get the data, and fill in
    // the item DOM when the query completes.
    prepareItemModel: function(index, callback) {
      setTimeout(callback.bind(null, index, true));
    },

    populateItem: function(element, model) {
      return false;
    },

    cancelItem: function(index) {
// TODO is this even needed now?
    },

    getScrollPos: function() {
      return this.scrollEventNode.scrollTop;
    },

    getScrollPortHeight: function() {
      return this.scrollEventNode.clientHeight;
    },

    _enableEventHandlers: function() {
      if (this._eventHandlersEnabled) {
        return;
      }
      this.scrollEventNode.addEventListener('scroll',
                                            this._scheduleGenerateItems);
      this.scrollEventNode.addEventListener('resize',
                                            this._scheduleGenerateItems);
    },

    _disableEventHandlers: function() {
      if (!this._eventHandlersEnabled) {
        return;
      }
      this.scrollEventNode.removeEventListener('scroll',
                                               this._scheduleGenerateItems);
      this.scrollEventNode.removeEventListener('resize',
                                               this._scheduleGenerateItems);
    }

  };

  return VScroll;
});





