import React from 'react';
import { Pressable, Text, View } from 'react-native';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

/**
 * Root error boundary — catches uncaught render-time errors so the app
 * shows a recoverable screen instead of a blank white crash.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console in development; swap for a real error reporter in production
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FAFAFA',
            padding: 32,
            gap: 16,
          }}
        >
          <Text style={{ fontSize: 40 }}>🙈</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#1C1C1C', textAlign: 'center' }}>
            Something went wrong
          </Text>
          <Text style={{ fontSize: 14, color: '#737373', textAlign: 'center', lineHeight: 20 }}>
            Rally hit an unexpected error. Tap below to try again.
          </Text>
          <Pressable
            onPress={this.handleReset}
            style={{
              marginTop: 8,
              paddingVertical: 14,
              paddingHorizontal: 32,
              borderRadius: 14,
              backgroundColor: '#FF6B5B',
            }}
          >
            <Text style={{ color: 'white', fontWeight: '600', fontSize: 15 }}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}
