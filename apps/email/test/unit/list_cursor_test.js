'use strict';
/* global testConfig */

requireApp('email/js/alameda.js');
requireApp('email/test/config.js');

/**

 * Fake MailMessage instances for our cursor's list.
 */
var MESSAGE_ONE = Object.freeze({ id: 'one' }),
    MESSAGE_TWO = Object.freeze({ id: 'two' }),
    MESSAGE_THREE = Object.freeze({ id: 'three' });

suite('ListCursor', function() {
  var evt, listCursor, CurrentItem;

  suiteSetup(function(done) {
    testConfig({ done: done }, [
      'evt',
      'list_cursor'
    ], function(_evt, ListCursor) {
      evt = _evt;
      listCursor = new ListCursor();
      CurrentItem = ListCursor.CurrentItem;
    });
  });

  setup(function() {
    listCursor.list = {
      release: function() {},
      items: [
        MESSAGE_ONE,
        MESSAGE_TWO,
        MESSAGE_THREE
      ]
    };

    listCursor.currentItem = new CurrentItem(
      MESSAGE_TWO, {
        hasPrevious: true,
        hasNext: true
      }
    );
  });

  suite('#advance', function() {
    test('next should go to next', function(done) {
      listCursor.once('currentItem', function(currentItem) {
        assert.deepEqual(
          currentItem,
          new CurrentItem(MESSAGE_THREE, {
            hasPrevious: true,
            hasNext: false
          })
        );

        done();
      });

      listCursor.advance('next');
    });

    test('previous should go to previous', function(done) {
      listCursor.once('currentItem', function(currentItem) {
        assert.deepEqual(
          currentItem,
          new CurrentItem(MESSAGE_ONE, {
            hasPrevious: false,
            hasNext: true
          })
        );

        done();
      });

      listCursor.advance('previous');
    });

    test('should not die if advance out of bounds', function() {
      listCursor.currentItem = new CurrentItem(
        MESSAGE_THREE, {
          hasPrevious: true,
          hasNext: false
        }
      );

      // If this doesn't error, life is good!
      listCursor.advance('next');
    });
  });

  suite('#indexOfMessageById', function() {
    test('should be correct if contains message with id', function() {
      assert.ok(listCursor.indexOfMessageById('two'), 2);
    });

    test('should be -1 if not contains message with id', function() {
      assert.ok(listCursor.indexOfMessageById('purple'), -1);
    });
  });

  suite('#release', function() {
    test('should release list', function() {
      var release = sinon.stub(listCursor.list, 'release');
      listCursor.release();
      sinon.assert.called(release);
      assert.strictEqual(listCursor.list, null);
    });
  });
});
