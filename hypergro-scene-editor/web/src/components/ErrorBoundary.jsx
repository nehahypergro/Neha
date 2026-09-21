import React from 'react';
import { report } from '../lib/errors.js';

/** If the screen itself crashes, say so plainly and offer the two things that fix it. Work is autosaved, so say that too. */
export default class ErrorBoundary extends React.Component {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  componentDidCatch(error, info) { report(error, 'screen crashed', { component: String(info?.componentStack || '').slice(0, 1500) }); }
  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>This screen stopped working</h1>
        <p>Your changes were saved automatically, so nothing is lost. Reload the page to carry on. Our team has been told about the problem.</p>
        <div className="row-btns"><button className="btn accent" onClick={() => location.reload()}>Reload the page</button><button className="btn" onClick={() => { location.href = '/'; }}>Go to My creatives</button></div>
      </div>
    );
  }
}
