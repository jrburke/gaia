define(['./date', 'exports'], function ($date, exports) {
  'use strict';

  ////////////////////////////////////////////////////////////////////////////////
  // Autoconfig stuff

  /**
   * The number of milliseconds to wait for various (non-ActiveSync) XHRs to
   * complete during the autoconfiguration process. This value is intentionally
   * fairly large so that we don't abort an XHR just because the network is
   * spotty.
   */
  exports.AUTOCONFIG_TIMEOUT_MS = 30 * 1000;

  /**
   * The root of the ISPDB.  This must be HTTPS.  Okay to clobber for automated
   * tests, but should generally never be changed.
   */
  exports.ISPDB_AUTOCONFIG_ROOT = 'https://live.mozillamessaging.com/autoconfig/v1.1/';

  ////////////////////////////////////////////////////////////////////////////////
  // IMAP time constants

  /**
   * How recently synchronized does a time range have to be for us to decide that
   * we don't need to refresh the contents of the time range when opening a slice?
   * If the last full synchronization is more than this many milliseconds old, we
   * will trigger a refresh, otherwise we will skip it.
   */
  exports.OPEN_REFRESH_THRESH_MS = 10 * 60 * 1000;

  /**
   * How recently synchronized does a time range have to be for us to decide that
   * we don't need to refresh the contents of the time range when growing a slice?
   * If the last full synchronization is more than this many milliseconds old, we
   * will trigger a refresh, otherwise we will skip it.
   */
  exports.GROW_REFRESH_THRESH_MS = 60 * 60 * 1000;

  ////////////////////////////////////////////////////////////////////////////////
  // POP3 Sync Constants

  /**
   * As we're syncing with POP3, pause every N messages to save state to disk.
   * This value was chosen somewhat arbitrarily.
   */
  exports.POP3_SAVE_STATE_EVERY_N_MESSAGES = 50;

  /**
   * The maximum number of messages to retrieve during a single POP3
   * sync operation. If the number of unhandled messages left in the
   * spool exceeds this value, leftover messages will be filtered out of
   * this sync operation. They can later be downloaded through a
   * "download more messages..." option as per
   * <https://bugzil.la/939375>.
   *
   * This value (initially 100) is selected to be large enough that most
   * POP3 users won't exceed this many new messages in a given sync, but
   * small enough that we won't get completely overwhelmed that we have
   * to download this many headers.
   */
  exports.POP3_MAX_MESSAGES_PER_SYNC = 100;

  /**
   * If a message is larger than INFER_ATTACHMENTS_SIZE bytes, guess
   * that it has an attachment.
   */
  exports.POP3_INFER_ATTACHMENTS_SIZE = 512 * 1024;

  /**
   * Attempt to fetch this many bytes of messages during snippet fetching.
   */
  exports.POP3_SNIPPET_SIZE_GOAL = 4 * 1024; // in bytes

  ////////////////////////////////////////////////////////////////////////////////
  // General Sync Constants

  /**
   * How frequently do we want to automatically synchronize our folder list?
   * Currently, we think that once a day is sufficient.  This is a lower bound,
   * we may sync less frequently than this.
   *
   * TODO: This is dead, but we are probably a bit too overzealous with folder
   * list syncing now.
   */
  exports.SYNC_FOLDER_LIST_EVERY_MS = $date.DAY_MILLIS;

  /**
   * How many messages should we send to the UI in the first go?
   */
  exports.INITIAL_FILL_SIZE = 15;

  /**
   * How many days in the past should we first look for messages.
   *
   * IMAP only.
   */
  exports.INITIAL_SYNC_DAYS = 3;

  /**
   * When growing our synchronization range, what should be the initial number of
   * days we should scan?
   */
  exports.INITIAL_SYNC_GROWTH_DAYS = 3;

  /**
   * What should be multiple the current number of sync days by when we perform
   * a sync and don't find any messages?  There are upper bounds in
   * `ImapFolderSyncer.onSyncCompleted` that cap this and there's more comments
   * there.  Note that we keep moving our window back as we go.
   *
   * This was 1.6 for a while, but it was proving to be a bit slow when the first
   * messages start a ways back.  Also, once we moved to just syncing headers
   * without bodies, the cost of fetching more than strictly required went way
   * down.
   *
   * IMAP only.
   */
  exports.TIME_SCALE_FACTOR_ON_NO_MESSAGES = 2;

  /**
   * What is the furthest back in time we are willing to go?  This is an
   * arbitrary choice to avoid our logic going crazy, not to punish people with
   * comprehensive mail collections.
   *
   * All of our sync range timestamps are quantized UTC days, so we are sure to
   * use an already UTC-quantized timestamp here.
   *
   * IMAP only.
   */
  exports.OLDEST_SYNC_DATE = Date.UTC(1990, 0, 1);

  /**
   * Don't bother with iterative deepening if a folder has less than this many
   * messages; just sync the whole thing.  The trade-offs here are:
   *
   * - Not wanting to fetch more messages than we need.
   * - Because header envelope fetches are done in a batch and IMAP servers like
   *   to sort UIDs from low-to-high, we will get the oldest messages first.
   *   This can be mitigated by having our sync logic use request windowing to
   *   offset this.
   * - The time required to fetch the headers versus the time required to
   *   perform deepening.  Because of network and disk I/O, deepening can take
   *   a very long time
   *
   * IMAP only.
   */
  exports.SYNC_WHOLE_FOLDER_AT_N_MESSAGES = 40;

  ////////////////////////////////////////////////////////////////////////////////
  // MIME Size / Parsing / Streaming Constants

  /**
   * How many bytes-worth of typed array data should we accumulate before
   * condensing it into a Blob? Arbitrarily chosen.
   */
  exports.BYTES_PER_BLOB_CHUNK = 1024 * 1024;

  /**
   * How many bytes should we request for each IMAP FETCH chunk request?
   * (Currently used only by attachment downloading, not body fetching).
   */
  exports.BYTES_PER_IMAP_FETCH_CHUNK_REQUEST = 1024 * 1024;

  ////////////////////////////////////////////////////////////////////////////////
  // Error / Retry Constants

  /**
   * What is the maximum number of tries we should give an operation before
   * giving up on the operation as hopeless?  Note that in some suspicious
   * error cases, the try cont will be incremented by more than 1.
   *
   * This value is somewhat generous because we do assume that when we do
   * encounter a flakey connection, there is a high probability of the connection
   * being flakey in the short term.  The operations will not be excessively
   * penalized for this since IMAP connections have to do a lot of legwork to
   * establish the connection before we start the operation (CAPABILITY, LOGIN,
   * CAPABILITY).
   */
  exports.MAX_OP_TRY_COUNT = 10;

  /**
   * The value to increment the operation tryCount by if we receive an
   * unexpected error.
   */
  exports.OP_UNKNOWN_ERROR_TRY_COUNT_INCREMENT = 5;

  /**
   * If we need to defer an operation because the folder/resource was not
   * available, how long should we defer for?
   */
  exports.DEFERRED_OP_DELAY_MS = 30 * 1000;

  ////////////////////////////////////////////////////////////////////////////////
  // General defaults

  /**
   * We use an enumerated set of sync values for UI localization reasons; time
   * is complex and we don't have/use a helper library for this.
   */
  exports.CHECK_INTERVALS_ENUMS_TO_MS = {
    'manual': 0, // 0 disables; no infinite checking!
    '3min': 3 * 60 * 1000,
    '5min': 5 * 60 * 1000,
    '10min': 10 * 60 * 1000,
    '15min': 15 * 60 * 1000,
    '30min': 30 * 60 * 1000,
    '60min': 60 * 60 * 1000
  };

  /**
   * Default to not automatically checking for e-mail for reasons to avoid
   * degrading the phone experience until we are more confident about our resource
   * usage, etc.
   */
  exports.DEFAULT_CHECK_INTERVAL_ENUM = 'manual';

  /**
   * How many milliseconds should we wait before giving up on the
   * connection?
   *
   * This really wants to be adaptive based on the type of the
   * connection, but right now we have no accurate way of guessing how
   * good the connection is in terms of latency, overall internet
   * speed, etc. Experience has shown that 10 seconds is currently
   * insufficient on an unagi device on 2G on an AT&T network in
   * American suburbs, although some of that may be problems internal
   * to the device. I am tripling that to 30 seconds for now because
   * although it's horrible to drag out a failed connection to an
   * unresponsive server, it's far worse to fail to connect to a real
   * server on a bad network, etc.
   */
  exports.CONNECT_TIMEOUT_MS = 30000;

  /**
   * When an IMAP connection has been left in the connection pool for
   * this amount of time, don't use that connection; spin up a fresh
   * connection instead. This value should be large enough that we don't
   * constantly spin up new connections, but short enough that we might
   * actually have connections open for that length of time.
   */
  exports.STALE_CONNECTION_TIMEOUT_MS = 30000;

  /**
   * Kill any open IMAP connections if there are no jobs pending and there are no
   * slices open. This flag is mainly just for unit test sanity because 1) most
   * tests were written before this flag existed and 2) most tests don't care.
   * This gets disabled by default in testing; tests that care should turn this
   * back on.
   */
  exports.KILL_CONNECTIONS_WHEN_JOBLESS = true;

  var DAY_MILLIS = 24 * 60 * 60 * 1000;

  /**
   * Map the ActiveSync-limited list of sync ranges to milliseconds.  Do NOT
   * add additional values to this mapping unless you make sure that our UI
   * properly limits ActiveSync accounts to what the protocol supports.
   */
  exports.SYNC_RANGE_ENUMS_TO_MS = {
    // This choice is being made for IMAP.
    'auto': 30 * DAY_MILLIS,
    '1d': 1 * DAY_MILLIS,
    '3d': 3 * DAY_MILLIS,
    '1w': 7 * DAY_MILLIS,
    '2w': 14 * DAY_MILLIS,
    '1m': 30 * DAY_MILLIS,
    'all': 30 * 365 * DAY_MILLIS
  };

  /**
   * What should our target be for snippet length?  In v1 this was 100, for v3
   * we want two lines worth, so we're bumping a little bit.  But this should
   * really just be parametrized by the consumer.
   */
  exports.DESIRED_SNIPPET_LENGTH = 160;

  /**
   * How big a chunk of an attachment should we encode in a single read?  Because
   * we want our base64-encoded lines to be 76 bytes long (before newlines) and
   * there's a 4/3 expansion factor, we want to read a multiple of 57 bytes.
   *
   * I initially chose the largest value just under 1MiB.  This appeared too
   * chunky on the ZTE open, so I'm halving to just under 512KiB.  Calculated via
   * Math.floor(512 * 1024 / 57) = 9198.  The encoded size of this ends up to be
   * 9198 * 78 which is ~700 KiB.  So together that's ~1.2 megs if we don't
   * generate a ton of garbage by creating a lot of intermediary strings.
   *
   * This seems reasonable given goals of not requiring the GC to run after every
   * block and not having us tie up the CPU too long during our encoding.
   */
  exports.BLOB_BASE64_BATCH_CONVERT_SIZE = 9198 * 57;

  ////////////////////////////////////////////////////////////////////////////////
  // Cronsync/periodic sync stuff

  /**
   * Caps the number of quas-headers we report to the front-end via cronsync
   * completion notifications (per-account).  We report the newest headers from
   * each sync.
   *
   * The value 5 was arbitrarily chosen, but per :jrburke, the current (hamachi,
   * flame) phone devices in portrait orientation "can fit about three unique
   * names in a grouped notification", so 5 still seems like a pretty good value.
   * This may want to change on landscape devices or devices with more screen
   * real-estate, like tablets.
   */
  exports.CRONSYNC_MAX_MESSAGES_TO_REPORT_PER_ACCOUNT = 5;

  /**
   * Caps the number of snippets we are willing to fetch as part of each cronsync
   * for each account.  We fetch snippets for the newest headers.
   *
   * The primary factors here are:
   * - Latency of sync reporting.  Right now, snippet fetches will defer the
   *   cronsync completion notification.
   * - Optimizing UX by having the snippets already available when the user goes
   *   to view the message list, at least the top of the message list.  An
   *   interacting factor is how good the UI is at requesting snippets in
   *   advance of messages being displayed on the screen.
   *
   * The initial/current value of 5 was chosen because a Hamachi device could
   * show 5 messages on the screen at a time.  On fancier devices like the flame,
   * this is still approximately right; about 5.5 messages are visible on 2.0,
   * with the snippet part for the last one not displayed.
   */
  exports.CRONSYNC_MAX_SNIPPETS_TO_FETCH_PER_ACCOUNT = 5;

  /**
   * What's the largest portion of a message's body content to fetch in order
   * to generate a snippet?
   *
   * The 4k value is chosen to match the Gaia mail app's use of 4k in its
   * snippet fetchin as we scroll.  Arguably that choice should be superseded
   * by this constant in the future.
   * TODO: make front-end stop specifying snippet size.
   */
  exports.MAX_SNIPPET_BYTES = 4 * 1024;

  ////////////////////////////////////////////////////////////////////////////////
  // Unit test support

  /**
   * Override individual syncbase values for unit testing. Any key in
   * syncbase can be overridden.
   */
  exports.TEST_adjustSyncValues = function TEST_adjustSyncValues(syncValues) {

    // Legacy values: This function used to accept a mapping that didn't
    // match one-to-one with constant names, but was changed to map
    // directly to constant names for simpler grepping.
    var legacyKeys = {
      fillSize: 'INITIAL_FILL_SIZE',
      days: 'INITIAL_SYNC_DAYS',
      growDays: 'INITIAL_SYNC_GROWTH_DAYS',
      wholeFolderSync: 'SYNC_WHOLE_FOLDER_AT_N_MESSAGES',
      bisectThresh: 'BISECT_DATE_AT_N_MESSAGES',
      tooMany: 'TOO_MANY_MESSAGES',
      scaleFactor: 'TIME_SCALE_FACTOR_ON_NO_MESSAGES',
      openRefreshThresh: 'OPEN_REFRESH_THRESH_MS',
      growRefreshThresh: 'GROW_REFRESH_THRESH_MS'
    };

    for (var key in syncValues) {
      if (syncValues.hasOwnProperty(key)) {
        var outKey = legacyKeys[key] || key;
        if (exports.hasOwnProperty(outKey)) {
          exports[outKey] = syncValues[key];
        } else {
          // In the future (after we have a chance to review all calls to
          // this function), we could make this throw an exception
          // instead.
          console.warn('Invalid key for TEST_adjustSyncValues: ' + key);
        }
      }
    }
  };
}); // end define
