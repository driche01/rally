import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../components/ui/Button';

describe('Button', () => {
  it('renders children text', () => {
    const { getByText } = render(<Button>Press me</Button>);
    expect(getByText('Press me')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button onPress={onPress}>Tap</Button>);
    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(
      <Button onPress={onPress} disabled>
        Disabled
      </Button>
    );
    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not call onPress when loading', () => {
    const onPress = jest.fn();
    const { getByRole } = render(
      <Button onPress={onPress} loading>
        Loading
      </Button>
    );
    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows an ActivityIndicator when loading', () => {
    const { queryByText, UNSAFE_getByType } = render(
      <Button loading>Click me</Button>
    );
    // Text is replaced by spinner
    expect(queryByText('Click me')).toBeNull();
    // ActivityIndicator is present
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });

  it('has accessible button role', () => {
    const { getByRole } = render(<Button>OK</Button>);
    expect(getByRole('button')).toBeTruthy();
  });
});
