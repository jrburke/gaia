define(function (require) {
  'use strict';

  var co = require('co');
  var logic = require('logic');

  var util = require('../util');
  var bsearchMaybeExists = util.bsearchMaybeExists;
  var bsearchForInsert = util.bsearchForInsert;

  var RefedResource = require('../refed_resource');

  var evt = require('evt');

  var { folderConversationComparator } = require('./comparators');

  /**
   * Backs view-slices listing the conversations in a folder.
   *
   * The current approach is that at activation time we load the entirety of the
   * ordered conversations for a folder, but just their conversation id and most
   * recent message, which constitute our ordering/identifying composite key.
   * This is a small enough amount of information that it is not unreasonable to
   * have it in memory given that we only list synchronized messages and that our
   * correlated resource constraints limit how much we sync.  In a fancy future
   * maybe we would not keep everything in memory.  However this strategy also
   * potentially could be beneficial with supporting full-sorting.  In any event,
   * we assume this means that once activated that we can synchronously tell you
   * everything you want to know about the ordering of the list.
   *
   * Our composite key is { date, id }, ordered thusly.  From a seek/persistence
   * perspective, if a conversation gets updated, it is no longer the same and
   * we instead treat the position where the { date, id } would be inserted now.
   */
  function FolderConversationsTOC({ db, folderId, dataOverlayManager,
    onForgotten }) {
    RefedResource.call(this);
    evt.Emitter.call(this);

    logic.defineScope(this, 'FolderConversationsTOC');

    this._db = db;
    this.folderId = folderId;
    this._onForgotten = onForgotten;
    this._eventId = '';

    // We share responsibility for providing overlay data with the list proxy.
    // Our getDataForSliceRange performs the resolving, but we depend on the proxy
    // to be listening for overlay updates and to perform appropriate dirtying.
    this._overlayResolver = dataOverlayManager.makeBoundResolver(this.overlayNamespace, null);

    this._bound_onTOCChange = this.onTOCChange.bind(this);

    this.__deactivate(true);
  }
  FolderConversationsTOC.prototype = evt.mix(RefedResource.mix({
    type: 'FolderConversationsTOC',
    overlayNamespace: 'conversations',
    heightAware: true,

    __activate: co.wrap(function* () {
      var { idsWithDates, drainEvents, eventId } = yield this._db.loadFolderConversationIdsAndListen(this.folderId);

      this.idsWithDates = idsWithDates;
      this._eventId = eventId;

      var totalHeight = 0;
      for (var info of idsWithDates) {
        totalHeight += info.height;
      }
      this.totalHeight = totalHeight;

      drainEvents(this._bound_onChange);
      this._db.on(eventId, this._bound_onTOCChange);
    }),

    __deactivate: function (firstTime) {
      this.idsWithDates = [];
      this.totalHeight = 0;
      if (!firstTime) {
        this._db.removeListener(this._eventId, this._bound_onTOCChange);
        if (this._onForgotten) {
          this._onForgotten(this, this.convId);
        }
        this._onForgotten = null;
      }
    },

    get length() {
      return this.idsWithDates.length;
    },

    /**
     * Handle a change from the database.
     *
     * @param {Object} change
     * @param {ConvId} id
     * @param {ConvInfo} item
     * @param {DateTS} removeDate
     * @param {DateTS} addDate
     * @param {Number} oldHeight
     */
    onTOCChange: function (change) {
      var metadataOnly = change.removeDate === change.addDate;

      if (!metadataOnly) {
        var oldIndex = -1;
        if (change.removeDate) {
          var oldKey = { date: change.removeDate, id: change.id };
          oldIndex = bsearchMaybeExists(this.idsWithDates, oldKey, folderConversationComparator);
          if (oldIndex !== -1) {
            // NB: if we computed the newIndex before splicing out, we could avoid
            // potentially redundant operations, but it's not worth the complexity
            // at this point.
            this.totalHeight -= change.oldHeight;
            this.idsWithDates.splice(oldIndex, 1);
          } else {
            throw new Error('freakout! item should exist');
          }
        }
        var newIndex = -1;
        if (change.addDate) {
          var newKey = { date: change.addDate, id: change.id,
            height: change.item.height };
          newIndex = bsearchForInsert(this.idsWithDates, newKey, folderConversationComparator);
          this.totalHeight += change.item.height;
          this.idsWithDates.splice(newIndex, 0, newKey);
        }

        // If we did end up keeping the conversation in place, then it was just
        // a metadata change as far as our consumers know/care.
        if (oldIndex === newIndex) {
          metadataOnly = true;
        }
      } else {
        this.totalHeight += change.item.height - change.oldHeight;
      }

      // We could expose more data, but WindowedListProxy doesn't need it, so
      // don't expose it yet.  If we end up with a fancier consumer (maybe a neat
      // debug visualization?), it could make sense to expose the indices being
      // impacted.
      this.emit('change', change.id, metadataOnly);
    },

    /**
     * Return an array of the conversation id's occupying the given indices.
     */
    sliceIds: function (begin, end) {
      var ids = [];
      var idsWithDates = this.idsWithDates;
      for (var i = begin; i < end; i++) {
        ids.push(idsWithDates[i].id);
      }
      return ids;
    },

    getOrderingKeyForIndex: function (index) {
      if (this.idsWithDates.length === 0) {
        return this.getTopOrderingKey();
      } else if (index < 0) {
        index = 0;
      } else if (index >= this.idsWithDates.length) {
        index = this.idsWithDates.length - 1;
      }
      return this.idsWithDates[index];
    },

    /**
     * Generate an ordering key that is from the distant future, effectively
     * latching us to the top.  We use this for the coordinate-space case where
     * there is nothing loaded yet.
     */
    getTopOrderingKey: function () {
      return {
        date: new Date(2200, 0),
        id: '',
        height: 0
      };
    },

    findIndexForOrderingKey: function (key) {
      var index = bsearchForInsert(this.idsWithDates, key, folderConversationComparator);
      return index;
    },

    /**
     * Given a quantized height offset, find the item covering that offset and
     * return it and related information.
     *
     * For example, if we have three items with height 3 (and therefore starting
     * at offsets [0, 3, 6]), then getInfoForOffset(5) will find the item at
     * offset
     *
     * NOTE! This is currently implemented as an iterative brute-force from the
     * front.  This is dumb, but probably good enough.  Since this ordering is
     * immutable most of the time, a primitive skip-list is probably even
     * overkill.  Just caching the last offset or two and their indices is
     * probably sufficient.  But even that's for the future.
     *
     * @return {Object}
     * @prop {OrderingKey} orderingKey
     * @prop {Number} offset
     *   The height offset the item with the given ordering key starts at.
     * @prop {Number} cumulativeHeight
     *   The height offset the item with the given ordering key ends at.
     *   (You can also think of this as the offset the next item starts at.)
     */
    getInfoForOffset: function (desiredOffset) {
      // NB: because this is brute-force, we are falling back to var since we know
      // that let is bad news in SpiderMonkey at the current tim.
      var actualOffset = 0;

      var idsWithDates = this.idsWithDates;
      var len = idsWithDates.length;
      var meta;
      for (var i = 0; i < len; i++) {
        meta = idsWithDates[i];
        // if this would put us over the limit, we've found it!
        if (desiredOffset < actualOffset + meta.height) {
          break;
        }
        actualOffset += meta.height;
      }
      if (!len) {
        meta = this.getTopOrderingKey();
      }

      return {
        orderingKey: meta,
        offset: actualOffset,
        cumulativeHeight: actualOffset + meta.height
      };
    },

    getHeightOffsetForIndex: function (desiredIndex) {
      var height = 0;
      var idsWithDates = this.idsWithDates;
      desiredIndex = Math.min(desiredIndex, idsWithDates.length);
      for (var i = 0; i < desiredIndex; i++) {
        height += idsWithDates[i].height;
      }
      return height;
    },

    /**
     * Traverse items covering a height.  All indices are inclusive because it's
     * stable under successive calls and symmetric for the direction of traversal.
     * Add one to the index if you want exclusive.
     *
     * @param {Number} startIndex
     * @param {1,-1} delta
     *   Should be +1 or -1.
     * @param {Number} heightToConsume
     *   The number of height units you want us to walk.  If negative, we'll just
     *   immediately return with the state you provided to us.
     *
     * @return {Object}
     * @prop {Number} overconsumed
     *   Additional height units covered by this returned index.
     */
    _walkToCoverHeight: function (startIndex, delta, heightToConsume) {
      var index = startIndex;
      var idsWithDates = this.idsWithDates;
      var info = index < idsWithDates.length && idsWithDates[index];
      var tooHigh = idsWithDates.length - 1;

      while (heightToConsume > 0 && index < tooHigh && index + delta >= 0) {
        index += delta;
        info = this.idsWithDates[index];
        heightToConsume -= info.height;
      }
      return {
        index,
        overconsumed: Math.abs(heightToConsume)
      };
    },

    /**
     * Given an ordering key and a number of requested visible/buffer height
     * units, return the set of appropriate indices.  Although this could be
     * exposed as a series of smaller operations for the caller to make, since we
     * may eventually want to have a clever representation of our list and the
     * height information, it's better to let all the cleverness happen in one
     * place.  When we inevitably need this logic someplace else, we should
     * partition all this crap out into a mix-in or something we can subclass.
     */
    findIndicesFromCoordinateSoup: function (req) {
      var focusIndex = this.findIndexForOrderingKey(req.orderingKey);
      if (focusIndex >= this.idsWithDates.length && this.idsWithDates.length) {
        // Don't try and display something that doesn't exist.  Display at least
        // something!
        focusIndex--;
      }

      var { index: beginVisibleInclusive, overconsumed: beforeOverconsumed } = this._walkToCoverHeight(focusIndex, -1, req.visibleAbove);
      var { index: beginBufferedInclusive } = this._walkToCoverHeight(beginVisibleInclusive, -1, req.bufferAbove - beforeOverconsumed);

      var { index: endVisibleInclusive, overconsumed: afterOverconsumed } = this._walkToCoverHeight(focusIndex, 1, req.visibleBelow);
      var { index: endBufferedInclusive } = this._walkToCoverHeight(endVisibleInclusive, 1, req.bufferBelow - afterOverconsumed);

      var rval = {
        beginBufferedInclusive,
        beginVisibleInclusive,
        endVisibleExclusive: endVisibleInclusive + 1,
        endBufferedExclusive: endBufferedInclusive + 1,
        heightOffset: this.getHeightOffsetForIndex(beginBufferedInclusive)
      };
      return rval;
    },

    getDataForSliceRange: function (beginInclusive, endExclusive, alreadyKnownData, alreadyKnownOverlays) {
      beginInclusive = Math.max(0, beginInclusive);
      endExclusive = Math.min(endExclusive, this.idsWithDates.length);

      var overlayResolver = this._overlayResolver;

      // State and overlay data to be sent to our front-end view counterpart.
      // This is (needed) state information we have synchronously available from
      // the db cache and (needed) overlay information (which can always be
      // synchronously derived.)
      var sendState = new Map();
      // Things we need to request from the database.  (Although MailDB.read will
      // immediately populate the things we need, WindowedListProxy's current
      // wire protocol calls for omitting things we don't have the state for yet.
      // And it's arguably nice to avoid involving going async here with flushes
      // and all that if we can avoid it.
      var needData = new Map();
      // The new known set which is the stuff from alreadyKnownData we reused plus
      // the data we were able to provide synchronously.  (And the stuff we have
      // to read from the DB does NOT go in here.)
      var newKnownSet = new Set();

      var idsWithDates = this.idsWithDates;
      var convCache = this._db.convCache;
      var ids = [];
      for (var i = beginInclusive; i < endExclusive; i++) {
        var id = idsWithDates[i].id;
        ids.push(id);
        var haveData = alreadyKnownData.has(id);
        var haveOverlays = alreadyKnownOverlays.has(id);
        if (haveData && haveOverlays) {
          newKnownSet.add(id);
          continue;
        }

        if (haveData) {
          // only need overlays
          sendState.set(id, [null, overlayResolver(id)]);
        } else if (convCache.has(id)) {
          newKnownSet.add(id);
          sendState.set(id, [convCache.get(id), overlayResolver(id)]);
        } else {
          needData.set(id, null);
        }
      }

      var readPromise = null;
      if (needData.size) {
        readPromise = this._db.read(this, {
          conversations: needData
        });
      } else {
        needData = null;
      }

      return {
        ids: ids,
        state: sendState,
        pendingReads: needData,
        readPromise,
        newValidDataSet: newKnownSet
      };
    }
  }));

  return FolderConversationsTOC;
});
