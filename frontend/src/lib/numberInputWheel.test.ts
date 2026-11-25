import { afterEach, describe, expect, it } from 'vitest';
import { preventNumberInputWheel } from './numberInputWheel';

afterEach(() => {
  document.body.replaceChildren();
  document.removeEventListener('wheel', preventNumberInputWheel, true);
});

describe('number input wheel guard', () => {
  it('keeps a focused number unchanged and scrolls its container', () => {
    const container = document.createElement('div');
    container.style.overflowY = 'auto';
    Object.defineProperty(container, 'scrollHeight', { value: 500 });
    Object.defineProperty(container, 'clientHeight', { value: 100 });
    const input = document.createElement('input');
    input.type = 'number';
    input.value = '48';
    container.append(input);
    document.body.append(container);
    input.focus();
    document.addEventListener('wheel', preventNumberInputWheel, { capture: true, passive: false });

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 60 });
    input.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(input.value).toBe('48');
    expect(input).toHaveFocus();
    expect(container.scrollTop).toBe(60);
  });

  it('leaves other inputs and unfocused number inputs alone', () => {
    const text = document.createElement('input');
    const number = document.createElement('input');
    number.type = 'number';
    document.body.append(text, number);
    document.addEventListener('wheel', preventNumberInputWheel, { capture: true, passive: false });
    text.focus();

    const textWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true });
    text.dispatchEvent(textWheel);
    const numberWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true });
    number.dispatchEvent(numberWheel);

    expect(textWheel.defaultPrevented).toBe(false);
    expect(numberWheel.defaultPrevented).toBe(false);
  });
});
