import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { toast } from '../lib/toast';
import { Button, Card, ErrorBox, Page } from '../components/ui';

/** "Send feedback" for sellers and customers during the pilot. Messages go to the OrderBook admins. */
export function FeedbackPage({ backTo }: { backTo: string }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/feedback', { method: 'POST', body: JSON.stringify({ message, page: backTo }) });
      toast.success('Thank you! Your feedback was sent.');
      navigate(backTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Send feedback" subtitle="Tell us what is confusing, broken or missing. The OrderBook team reads every message." backTo={backTo}>
      <Card>
        <form onSubmit={send} className="space-y-3">
          <label className="block" htmlFor="feedback-message">
            <span className="label">Your message</span>
            <textarea
              id="feedback-message"
              className="input min-h-36 py-3"
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. I could not find where to change a price"
              autoFocus
            />
          </label>
          {error && <ErrorBox message={error} />}
          <Button type="submit" className="w-full" disabled={busy || message.trim().length < 3}>
            {busy ? 'Sending…' : 'Send feedback'}
          </Button>
        </form>
      </Card>
    </Page>
  );
}
