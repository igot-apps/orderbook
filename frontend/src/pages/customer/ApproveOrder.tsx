import { PreparedOrder } from '../../components/PreparedOrder';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { ghs } from '../../lib/format';
import { toast } from '../../lib/toast';
import {
  Button,
  ConfirmDialog,
  Dialog,
  Empty,
  ErrorBox,
  SkeletonList,
  Page,
  SuccessScreen,
  StatusBadge,
  TextArea,
} from '../../components/ui';

export function ApproveOrderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [mode, setMode] = useState<'review' | 'change'>('review');
  const [accepted, setAccepted] = useState(false);

  const { data: order, isLoading, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<any>(`/orders/${id}`),
  });

  const mut = useMutation({
    meta: { silentError: true },
    mutationFn: (body: { action: 'ACCEPT' | 'REQUEST_CHANGE'; message?: string }) =>
      api(`/orders/${id}/respond`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['customer-dashboard'] });
      qc.invalidateQueries({ queryKey: ['customer-orders'] });
      setConfirmAccept(false);
      if (vars.action === 'ACCEPT') {
        setAccepted(true);
      } else {
        setMode('review');
        toast.success('Change request sent to the shop');
        navigate(`/customer/orders/${id}`);
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save your response. Please try again.'),
  });

  if (isLoading) {
    return (
      <Page title="Review adjustment"><SkeletonList rows={3} /></Page>
    );
  }
  if (!order) {
    return (
      <Page title="Approval">
        <Empty title="Order not found" hint="It may have been removed or the link is wrong." action={<Link to="/customer/orders"><Button variant="secondary">Back to orders</Button></Link>} />
      </Page>
    );
  }

  const rev = [...(order.revisions || [])]
    .reverse()
    .find((r: any) => r.sentForApprovalAt && !r.agreement);

  if (accepted) {
    return (
      <SuccessScreen
        open
        title="Order approved"
        message="Your invoice is locked. You can pay now or later from your orders."
        primary={{ label: 'View order', onClick: () => navigate(`/customer/orders/${id}`) }}
        secondary={{ label: 'Back to Home', onClick: () => navigate('/customer') }}
      />
    );
  }

  if (order.status !== 'AWAITING_CUSTOMER_APPROVAL' || !rev) {
    return (
      <Page title="Approval" backTo={`/customer/orders/${id}`} backLabel="Order">
        <Empty
          title="Nothing to approve"
          hint="This order is not awaiting your approval — its status may have changed."
          action={<Link to={`/customer/orders/${id}`}><Button variant="secondary">View order</Button></Link>}
        />
      </Page>
    );
  }

  const diffNum = Number(rev.differenceAmount || 0);
  const increased = diffNum > 0;

  return (
    <Page title="Review adjustment" backTo={`/customer/orders/${id}`} backLabel="Order" actions={<StatusBadge status={order.status} />}>
      <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900" role="note">
        The prepared amounts differ from what you ordered. {increased ? 'The total went up — check why before accepting.' : 'Review the final amounts before the invoice is locked.'}
      </div>

      <PreparedOrder order={order} revision={rev} />

      {error && (
        <div className="mt-3">
          <ErrorBox message={error} onRetry={() => { setError(''); refetch(); }} />
        </div>
      )}

      <div className="mt-6 space-y-2 rounded-3xl border border-slate-200/70 bg-white p-3 shadow-sm">
        <Button variant="success" className="w-full !min-h-14 text-base" disabled={mut.isPending} onClick={() => setConfirmAccept(true)}>
          Accept · {ghs(rev.grandTotal)}
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => setMode('change')}>
          Request a change
        </Button>
      </div>

      <ConfirmDialog
        open={confirmAccept}
        onClose={() => setConfirmAccept(false)}
        onConfirm={() => mut.mutate({ action: 'ACCEPT' })}
        busy={mut.isPending}
        title={`Accept ${ghs(rev.grandTotal)}?`}
        description="This locks the invoice and lets the seller request payment."
        confirmLabel="Yes, accept"
      />

      <Dialog
        open={mode === 'change'}
        onClose={() => setMode('review')}
        title="Request a change"
        description="Tell the shop what you'd like adjusted."
        footer={
          <Button
            className="w-full !min-h-14"
            disabled={!message.trim() || mut.isPending}
            onClick={() => mut.mutate({ action: 'REQUEST_CHANGE', message: message.trim() })}
          >
            {mut.isPending ? 'Sending…' : 'Send change request'}
          </Button>
        }
      >
        <TextArea
          label="What should change?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Please reduce the salmon closer to GH₵40"
        />
      </Dialog>
    </Page>
  );
}
