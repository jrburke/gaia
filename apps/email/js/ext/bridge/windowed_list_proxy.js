define(function (require) {
  'use strict';

  /**
   * Works with specific *TOC implementations to provide the smarts to the
   * WindowedListView at the other end of a bridge.  The TOC does all of the hard
   * work like keeping an ordered view of something, listening for changes, and
   * otherwise interacting with the database.
   *
   * Our implementation is almost trivially simple.  We listen for changes from
   * the TOC that affect us and dirty our state (and tell the batch manager we
   * need to be flushed) if anything interesting happens.
   *
   * Almost everything is interesting as far as we're concerned.  Specifically,
   * there are two types of things that can happen:
   * - The ordered list of id's owned by the TOC can change.  (We don't care about
   *   the contents, although changes in contents may be correlated with changes
   *   in ordering.)  We dirty ourselves because this is at the very least very
   *   likely to impact the totalCount and necessitate a flush.
   * - The contents of some stuff in the list changed, but not the ordering.  We
   *   only care about this if the thing that changed was in our list.
   *
   * Our responsibilities are pretty simple:
   * - We convert the front-end's seek request into a stable form.  Right now this
   *   is top, bottom, or focused on a specific point in the ordering key-space.
   *   TODO: In the future the specific point may be adjusted to keep the point
   *   referencing some underlying real item.  That's been the `BrowserContext`
   *   plan but we might as well wait until we implement `BrowserContext` to do
   *   that.
   * - We track what the corresponding view knows about so we can know when it
   *   becomes outdated and to avoid sending redundant information to the view.
   * - We figure out when we are "dirty" in that we need to send some data to the
   *   front-end.  We tell the BatchManager this.
   * - We produce the payload to send over the bridge when `flush` is called by
   *   the BatchManager.  We don't actually know who the bridge is or how to talk
   *   to them.
   * - TODO: Propagate priority information based on what the user can currently
   *   see.  SOME DAY SOON.
   *
   * Key / notable decisions:
   * - It is possible for us to know the id and position of something in the list
   *   and to not have the data immediately available.  We do not wait for the
   *   data to load; we just send what we have now and the view fills in nulls
   *   until we are able to provide it with the data.
   * - Coordination is greatly simplified by us owning the window state.  The
   *   WindowedListView asks for us to seek, but it does not modify its state
   *   AT ALL until we process the request and eventually flush, providing it with
   *   its new state.  This avoids complexities with asynchrony and state
   *   management.  If the view could forget things it thought it didn't care
   *   about, we'd have a major headache in knowing what we have to tell it as it
   *   seeks around.  So it can't.
   *
   * ## Accumulated State ##
   *
   * At all times we know:
   * - validDataSet: The id's that the view has valid state for (based on what we told
   *   it.)  As we hear about changes that are in our validDataSet, we remove them so
   *   that when we flush we pull the value from the database cache.
   */
  function WindowedListProxy(toc, ctx) {
    this.toc = toc;
    this.ctx = ctx;
    this.batchManager = ctx.batchManager;

    /**
     * The set of id's for which we have provided still-valid data to the
     * front-end/our view counterpart.  As items are modified and the data
     * rendered no longer up-to-date, we remove the id's from this set.  This will
     * trigger propagation of the data at flush-time.
     */
    this.validDataSet = new Set();

    /**
     * The same rationale as `validDataSet`, but for overlays.
     */
    this.validOverlaySet = new Set();

    this._bound_onChange = this.onChange.bind(this);
    this._bound_onOverlayPush = this.onOverlayPush.bind(this);
  }
  WindowedListProxy.prototype = {
    __acquire: function () {
      this.toc.on('change', this._bound_onChange);

      this.ctx.dataOverlayManager.on(this.toc.overlayNamespace, this._bound_onOverlayPush);

      return Promise.resolve(this);
    },

    __release: function () {
      this.toc.removeListener('change', this._bound_onChange);

      this.ctx.dataOverlayManager.removeListener(this.toc.overlayNamespace, this._bound_onOverlayPush);
    },

    seek: function (req) {
      // -- Index-based modes
      if (req.mode === 'top') {
        this.mode = req.mode;
        this.focusKey = null;
        this.bufferAbove = 0;
        this.visibleAbove = 0;
        this.visibleBelow = req.visibleDesired;
        this.bufferBelow = req.bufferDesired;
      } else if (req.mode === 'bottom') {
        this.mode = req.mode;
        this.focusKey = null;
        this.bufferAbove = req.bufferDesired;
        this.visibleAbove = req.visibleDesired;
        this.visibleBelow = 0;
        this.bufferBelow = 0;
      } else if (req.mode === 'focus') {
        this.mode = req.mode;
        this.focusKey = req.focusKey;
        this.bufferAbove = req.bufferAbove;
        this.visibleAbove = req.visibleAbove;
        this.visibleBelow = req.visibleBelow;
        this.bufferBelow = req.bufferBelow;
      } else if (req.mode === 'focusIndex') {
        this.mode = 'focus';
        this.focusKey = this.toc.getOrderingKeyForIndex(req.index);
        this.bufferAbove = req.bufferAbove;
        this.visibleAbove = req.visibleAbove;
        this.visibleBelow = req.visibleBelow;
        this.bufferBelow = req.bufferBelow;
      }
      // -- Height-aware modes
      else if (req.mode === 'coordinates') {
          if (this.toc.heightAware) {
            this.mode = req.mode;
            // In this case we want to anchor on the first visible item, so we take
            // the offset and add the "before" padding.
            var focalOffset = req.offset + req.before;
            var { orderingKey, offset } = this.toc.getInfoForOffset(focalOffset);
            this.focusKey = orderingKey;
            var focusUnitsNotVisible = Math.max(0, focalOffset - offset);
            this.bufferAbove = req.before - focusUnitsNotVisible;
            this.visibleAbove = 0;
            this.visibleBelow = req.visible - (offset - focalOffset);
            this.bufferBelow = req.after;
          }
          // if the TOC isn't height-aware we can just convert to focus mode with
          // an assumption of uniform height.
          else {
              this.mode = 'focus';
              this.focusKey = this.toc.getOrderingKeyForIndex(req.offset);
              this.bufferAbove = req.before;
              this.visibleAbove = 0;
              this.visibleBelow = req.visible;
              this.bufferBelow = req.after;
            }
        } else {
          throw new Error('bogus seek mode: ' + req.mode);
        }

      this.dirty = true;
      this.batchManager.registerDirtyView(this, /* immediate */true);
    },

    /**
     * Dirty ourselves if anything happened to the list ordering or if this is an
     * item change for something that's inside our window.
     *
     * NOTE: If/when we implement key stability stuff, it goes here.
     *
     * @param {String} [changeId=null]
     *   For the case where a specific record is now out-of-date and new state for
     *   it needs to be pushed, provide the id.  Note that if the record is not
     *   currently something we have reported, this method call becomes a no-op.
     *   Pass null if an ordering change has occurred.  If both things have
     *   occurred, call us twice!
     */
    onChange: function (id, metadataOnly) {
      if (id !== null) {
        // If we haven't told the view about the data, there's no need for us to
        // do anything.  Note that this also covers the case where we have an
        // async read in flight.
        if (!this.validDataSet.has(id) && metadataOnly) {
          return;
        }
        this.validDataSet.delete(id);
      }

      if (this.dirty) {
        return;
      }
      this.dirty = true;
      this.batchManager.registerDirtyView(this, /* immediate */false);
    },

    onOverlayPush: function (id) {
      if (!this.validOverlaySet.has(id)) {
        return;
      }
      this.validOverlaySet.delete(id);

      if (this.dirty) {
        return;
      }
      this.dirty = true;
      this.batchManager.registerDirtyView(this, /* immediate */false);
    },

    /**
     * Synchronously provide the update to be provided to our matching
     * WindowedListView.  If all of the data isn't available synchronously, we
     * will be provided with a Promise for when the data is available, and we'll
     * dirty ourselves again when that promise resolves.  Happily, if things have
     * changed by the time the promise is resolved, it's fine.
     *
     */
    flush: function () {
      var _this = this;

      var beginBufferedInclusive = undefined,
          beginVisibleInclusive = undefined,
          endVisibleExclusive = undefined,
          endBufferedExclusive = undefined,
          heightOffset = undefined;
      if (this.mode === 'top') {
        beginBufferedInclusive = beginVisibleInclusive = 0;
        endVisibleExclusive = Math.min(this.toc.length, this.visibleBelow + 1);
        endBufferedExclusive = Math.min(this.toc.length, endVisibleExclusive + this.bufferBelow);
      } else if (this.mode === 'bottom') {
        endBufferedExclusive = endVisibleExclusive = this.toc.length;
        beginVisibleInclusive = Math.max(0, endVisibleExclusive - this.visibleAbove);
        beginBufferedInclusive = Math.max(0, beginVisibleInclusive - this.bufferedAbove);
      } else if (this.mode === 'focus') {
        var focusIndex = this.toc.findIndexForOrderingKey(this.focusKey);
        beginVisibleInclusive = Math.max(0, focusIndex - this.visibleAbove);
        beginBufferedInclusive = Math.max(0, beginVisibleInclusive - this.bufferAbove);
        // we add 1 because the above/below stuff does not include the item itself
        endVisibleExclusive = Math.min(this.toc.length, focusIndex + this.visibleBelow + 1);
        endBufferedExclusive = Math.min(this.toc.length, endVisibleExclusive + this.bufferBelow);
      } else if (this.mode === 'coordinates') {
        // This is valid. JSHint bug: https://github.com/jshint/jshint/issues/2269
        ({ beginBufferedInclusive, beginVisibleInclusive, endVisibleExclusive,
          endBufferedExclusive, heightOffset } = this.toc.findIndicesFromCoordinateSoup({
          orderingKey: this.focusKey,
          bufferAbove: this.bufferAbove,
          visibleAbove: this.visibleAbove,
          visibleBelow: this.visibleBelow,
          bufferBelow: this.bufferBelow
        }));
      }

      this.dirty = false;

      // XXX prioritization hints should be generated as a result of the visible
      // range!

      var { ids, state, readPromise, newValidDataSet } = this.toc.getDataForSliceRange(beginBufferedInclusive, endBufferedExclusive, this.validDataSet, this.validOverlaySet);

      this.validDataSet = newValidDataSet;
      // We will have generated valid overlay information for all valid data
      // (filling in any holes), so duplicate the set.
      this.validOverlaySet = new Set(newValidDataSet);

      if (readPromise) {
        readPromise.then(function () {
          // Trigger an immediate dirtying/flush.
          _this.batchManager.registerDirtyView(_this, /* immediate */true);
        });
      }

      return {
        offset: beginBufferedInclusive,
        heightOffset: heightOffset || beginBufferedInclusive,
        totalCount: this.toc.length,
        totalHeight: this.toc.totalHeight,
        ids: ids,
        values: state
      };
    }
  };

  return WindowedListProxy;
});
