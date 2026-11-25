import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatWhen, ghs } from '../../lib/format';
import { Card, Empty, ErrorBox, Loading, Page } from '../../components/ui';

export function SellerPaymentsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api<any[]>('/payments'),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  return <Page title="Payments" subtitle="Payments received and receipts issued for your orders.">
    {isLoading ? <Loading /> : error ? <ErrorBox message="Could not load payments. Please try again." /> : !data?.length ? (
      <Empty title="No payments received yet" hint="Customer payments will appear here after checkout." />
    ) : <div className="space-y-3">
      {data.map((payment) => <Link key={payment.id} to={`/seller/receipts/${payment.id}`} className="block">
        <Card className="transition hover:border-indigo-200 hover:shadow-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-950">{payment.orderNumber}</div>
              <div className="mt-1 text-sm text-slate-500">{payment.network} · {formatWhen(payment.paidAt)}</div>
              <div className="mt-1 text-xs text-slate-500">Receipt {payment.receiptNumber}</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-emerald-700">{ghs(payment.amount)}</div>
              <div className="mt-1 text-xs font-semibold text-emerald-700">Paid</div>
            </div>
          </div>
        </Card>
      </Link>)}
    </div>}
  </Page>;
}
