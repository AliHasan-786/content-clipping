import { Metadata } from 'next';
import AnalyticsDashboard from '@/components/ui/analytics-dashboard';

export const metadata: Metadata = {
  title: 'Analytics Dashboard | ClipMaster',
  description: 'Revenue analytics and performance insights for your content clipping pipeline',
};

export default function AnalyticsPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <AnalyticsDashboard />
    </div>
  );
}
