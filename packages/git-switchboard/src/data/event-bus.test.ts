import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEventBus } from './event-bus.js';

type TestEvents = {
  'item:added': { id: string; value: number };
  'item:removed': { id: string };
};

describe('EventBus', () => {
  it('calls handler when event is emitted', () => {
    const bus = createEventBus<TestEvents>();
    const received: { id: string; value: number }[] = [];
    bus.on('item:added', (payload) => received.push(payload));
    bus.emit('item:added', { id: 'a', value: 1 });
    assert.deepEqual(received, [{ id: 'a', value: 1 }]);
  });

  it('does not call handler for other events', () => {
    const bus = createEventBus<TestEvents>();
    let called = false;
    bus.on('item:removed', () => {
      called = true;
    });
    bus.emit('item:added', { id: 'a', value: 1 });
    assert.equal(called, false);
  });

  it('supports multiple handlers for the same event', () => {
    const bus = createEventBus<TestEvents>();
    let count = 0;
    bus.on('item:added', () => {
      count++;
    });
    bus.on('item:added', () => {
      count++;
    });
    bus.emit('item:added', { id: 'a', value: 1 });
    assert.equal(count, 2);
  });

  it('returns unsubscribe function from on()', () => {
    const bus = createEventBus<TestEvents>();
    let count = 0;
    const unsub = bus.on('item:added', () => {
      count++;
    });
    bus.emit('item:added', { id: 'a', value: 1 });
    unsub();
    bus.emit('item:added', { id: 'b', value: 2 });
    assert.equal(count, 1);
  });

  it('off() removes a specific handler', () => {
    const bus = createEventBus<TestEvents>();
    let count = 0;
    const handler = () => {
      count++;
    };
    bus.on('item:added', handler);
    bus.off('item:added', handler);
    bus.emit('item:added', { id: 'a', value: 1 });
    assert.equal(count, 0);
  });

  it('handles emit with no listeners without error', () => {
    const bus = createEventBus<TestEvents>();
    assert.doesNotThrow(() => {
      bus.emit('item:added', { id: 'a', value: 1 });
    });
  });
});
