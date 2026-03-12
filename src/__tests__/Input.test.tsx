import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Input } from '../components/ui/Input';

describe('Input', () => {
  it('renders label when provided', () => {
    const { getByText } = render(<Input label="Email" />);
    expect(getByText('Email')).toBeTruthy();
  });

  it('renders error message', () => {
    const { getByText } = render(<Input error="Required" />);
    expect(getByText('Required')).toBeTruthy();
  });

  it('renders hint when no error', () => {
    const { getByText } = render(<Input hint="Max 60 chars" />);
    expect(getByText('Max 60 chars')).toBeTruthy();
  });

  it('does not show hint when error is present', () => {
    const { queryByText } = render(<Input hint="Hint text" error="Error text" />);
    expect(queryByText('Hint text')).toBeNull();
    expect(queryByText('Error text')).toBeTruthy();
  });

  it('calls onChangeText', () => {
    const handler = jest.fn();
    const { getByPlaceholderText } = render(
      <Input placeholder="Type here" onChangeText={handler} />
    );
    fireEvent.changeText(getByPlaceholderText('Type here'), 'hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });
});
