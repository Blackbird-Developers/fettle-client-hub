// @vitest-environment jsdom
import "@/test/setupDom";
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PhoneInput } from './PhoneInput';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PhoneInput id="phone" value={value} onChange={setValue} />
      <output data-testid="stored">{value}</output>
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: /^Country code/ });
const pick = (name: string) => {
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole('option', { name: new RegExp(name) }));
};
const input = () => document.getElementById('phone') as HTMLInputElement;
const stored = () => screen.getByTestId('stored').textContent;

afterEach(cleanup);

describe('PhoneInput', () => {
  it('lists Kosovo and filters by search', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.change(screen.getByPlaceholderText('Search country or code'), { target: { value: 'koso' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('option', { name: /Kosovo/ }));
    expect(trigger()).toHaveTextContent('KOS +383');
  });

  it('defaults to Ireland and stores an international number', () => {
    render(<Harness />);
    expect(trigger()).toHaveAccessibleName('Country code: Ireland +353');
    fireEvent.change(input(), { target: { value: '087 123 4567' } });
    expect(stored()).toBe('+353 87 123 4567');
  });

  it('changes the prefix when another country is picked', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: '7400 123456' } });
    pick('United Kingdom');
    expect(stored()).toBe('+44 7400 123456');
  });

  it('switches the dropdown when a full number is pasted', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: '+44 7400 123456' } });
    expect(trigger()).toHaveTextContent('UK +44');
    expect(stored()).toBe('+44 7400 123456');
  });

  it('splits a saved number into prefix and local part', () => {
    render(<Harness initial="+44 7400 123456" />);
    expect(trigger()).toHaveTextContent('UK +44');
    expect(input().value).toBe('07400 123456');
  });
});
