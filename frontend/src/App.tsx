import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { CustomerLayout, SellerLayout } from './components/layouts';
import { LoginPage, SignupPage } from './pages/LoginPage';
import { CustomerDashboard } from './pages/customer/Dashboard';
import { CataloguePage } from './pages/customer/Catalogue';
import { PlaceOrderPage } from './pages/customer/PlaceOrder';
import { CustomerOrdersPage } from './pages/customer/Orders';
import { ApproveOrderPage } from './pages/customer/ApproveOrder';
import {
  CustomerMorePage,
  CustomerNotificationsPage,
  CustomerPaymentsPage,
  CustomerProfilePage,
} from './pages/customer/More';
import { OrderDetailPage } from './pages/shared/OrderDetail';
import { PaymentPage } from './pages/PaymentPage';
import { ReceiptPage } from './pages/ReceiptPage';
import { SellerDashboard } from './pages/seller/Dashboard';
import { SellerOrdersPage } from './pages/seller/Orders';
import { SellerCustomersPage, SellerCustomerDetailPage } from './pages/seller/Customers';
import { SellerProductsPage } from './pages/seller/Products';
import { SellerPaymentsPage } from './pages/seller/Payments';
import {
  OutstandingPage,
  ReportsPage,
  SellerCreateOrderPage,
  SellerMorePage,
  SettingsPage,
} from './pages/seller/MorePages';
import { SellerShopsPage, SellerStaffPage } from './pages/seller/Team';
import { SellerPayoutsPage } from './pages/seller/Payouts';
import { SellerBillingPage } from './pages/seller/Billing';
import { SellerAdminPage } from './pages/seller/Admin';
import type { ReactNode } from 'react';

function RequireAuth({
  role,
  children,
}: {
  role?: 'SELLER' | 'CUSTOMER';
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'SELLER' ? '/seller' : '/customer'} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to={user.role === 'SELLER' ? '/seller' : '/customer'} replace />
          ) : (
            <LoginPage />
          )
        }
      />

      <Route
        path="/signup"
        element={user ? <Navigate to={user.role === 'SELLER' ? '/seller' : '/customer'} replace /> : <SignupPage />}
      />
      <Route
        path="/pay/:orderId"
        element={
          <RequireAuth>
            <PaymentPage />
          </RequireAuth>
        }
      />

      <Route
        path="/customer"
        element={
          <RequireAuth role="CUSTOMER">
            <CustomerLayout />
          </RequireAuth>
        }
      >
        <Route index element={<CustomerDashboard />} />
        <Route path="catalogue" element={<CataloguePage />} />
        <Route path="orders" element={<CustomerOrdersPage />} />
        <Route path="orders/new" element={<PlaceOrderPage />} />
        <Route path="orders/:id" element={<OrderDetailPage basePath="customer" />} />
        <Route path="orders/:id/approve" element={<ApproveOrderPage />} />
        <Route path="payments" element={<CustomerPaymentsPage />} />
        <Route path="receipts/:id" element={<ReceiptPage />} />
        <Route path="notifications" element={<CustomerNotificationsPage />} />
        <Route path="profile" element={<CustomerProfilePage />} />
        <Route path="more" element={<CustomerMorePage />} />
      </Route>

      <Route
        path="/seller"
        element={
          <RequireAuth role="SELLER">
            <SellerLayout />
          </RequireAuth>
        }
      >
        <Route index element={<SellerDashboard />} />
        <Route path="orders" element={<SellerOrdersPage />} />
        <Route path="orders/new" element={<SellerCreateOrderPage />} />
        <Route path="orders/:id" element={<OrderDetailPage basePath="seller" />} />
        <Route path="orders/:id/prepare" element={<Navigate to="/seller/orders" replace />} />
        <Route path="deliveries" element={<Navigate to="/seller/orders?status=AGREED" replace />} />
        <Route path="customers" element={<SellerCustomersPage />} />
        <Route path="customers/:id" element={<SellerCustomerDetailPage />} />
        <Route path="products" element={<SellerProductsPage />} />
        <Route path="payments" element={<SellerPaymentsPage />} />
        <Route path="outstanding" element={<OutstandingPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="receipts/:id" element={<ReceiptPage />} />
        <Route path="more" element={<SellerMorePage />} />
        <Route path="staff" element={<SellerStaffPage />} />
        <Route path="shops" element={<SellerShopsPage />} />
        <Route path="payouts" element={<SellerPayoutsPage />} />
        <Route path="billing" element={<SellerBillingPage />} />
        <Route path="admin" element={<SellerAdminPage />} />
      </Route>

      <Route
        path="*"
        element={
          <Navigate
            to={user ? (user.role === 'SELLER' ? '/seller' : '/customer') : '/login'}
            replace
          />
        }
      />
    </Routes>
  );
}
