'use client';

import {
  Shield,
  FileCheck,
  AlertTriangle,
  FileStack,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  Clock,
} from 'lucide-react';

const stats = [
  {
    name: 'Frameworks',
    value: '5',
    icon: FileStack,
    change: '+1',
    changeType: 'increase',
    description: 'Active compliance frameworks',
  },
  {
    name: 'Controls',
    value: '248',
    icon: Shield,
    change: '94%',
    changeType: 'neutral',
    description: 'Implemented controls',
  },
  {
    name: 'Evidence Items',
    value: '1,024',
    icon: FileCheck,
    change: '+12%',
    changeType: 'increase',
    description: 'Collected evidence',
  },
  {
    name: 'Open Risks',
    value: '18',
    icon: AlertTriangle,
    change: '-3',
    changeType: 'decrease',
    description: 'Risks requiring attention',
  },
];

const recentActivity = [
  {
    id: 1,
    action: 'Evidence uploaded',
    item: 'Access Control Policy v2.1',
    user: 'John Smith',
    time: '5 minutes ago',
    status: 'success',
  },
  {
    id: 2,
    action: 'Control assessment completed',
    item: 'AC-2 Account Management',
    user: 'Jane Doe',
    time: '1 hour ago',
    status: 'success',
  },
  {
    id: 3,
    action: 'Risk escalated',
    item: 'Third-party vendor access',
    user: 'Mike Johnson',
    time: '2 hours ago',
    status: 'warning',
  },
  {
    id: 4,
    action: 'Exception requested',
    item: 'Password complexity requirement',
    user: 'Sarah Williams',
    time: '3 hours ago',
    status: 'pending',
  },
];

const complianceOverview = [
  { framework: 'PCI DSS 4.0', score: 92, status: 'compliant' },
  { framework: 'SOC 2 Type II', score: 88, status: 'partial' },
  { framework: 'ISO 27001', score: 95, status: 'compliant' },
  { framework: 'NIST CSF', score: 78, status: 'partial' },
  { framework: 'HIPAA', score: 85, status: 'compliant' },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400">Welcome to your GRC command center</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.name} className="card">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-slate-700 p-3">
                <stat.icon className="h-6 w-6 text-primary-400" />
              </div>
              <div className="flex items-center gap-1 text-sm">
                {stat.changeType === 'increase' && (
                  <TrendingUp className="h-4 w-4 text-green-400" />
                )}
                {stat.changeType === 'decrease' && (
                  <TrendingDown className="h-4 w-4 text-green-400" />
                )}
                <span
                  className={
                    stat.changeType === 'increase'
                      ? 'text-green-400'
                      : stat.changeType === 'decrease'
                      ? 'text-green-400'
                      : 'text-slate-400'
                  }
                >
                  {stat.change}
                </span>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-3xl font-bold text-white">{stat.value}</p>
              <p className="text-sm text-slate-400">{stat.name}</p>
            </div>
            <p className="mt-2 text-xs text-slate-500">{stat.description}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-white">
            Compliance Overview
          </h2>
          <div className="space-y-4">
            {complianceOverview.map((item) => (
              <div key={item.framework} className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-300">
                      {item.framework}
                    </span>
                    <span className="text-sm font-medium text-white">
                      {item.score}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-700">
                    <div
                      className={`h-2 rounded-full ${
                        item.score >= 90
                          ? 'bg-green-500'
                          : item.score >= 80
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                      }`}
                      style={{ width: `${item.score}%` }}
                    ></div>
                  </div>
                </div>
                <div
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    item.status === 'compliant'
                      ? 'bg-green-900/50 text-green-400'
                      : 'bg-yellow-900/50 text-yellow-400'
                  }`}
                >
                  {item.status}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-white">
            Recent Activity
          </h2>
          <div className="space-y-4">
            {recentActivity.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 rounded-lg p-3 hover:bg-slate-700/50"
              >
                <div
                  className={`mt-0.5 rounded-full p-1 ${
                    activity.status === 'success'
                      ? 'bg-green-900/50 text-green-400'
                      : activity.status === 'warning'
                      ? 'bg-yellow-900/50 text-yellow-400'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {activity.status === 'success' ? (
                    <CheckCircle size={14} />
                  ) : activity.status === 'warning' ? (
                    <AlertTriangle size={14} />
                  ) : (
                    <Clock size={14} />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-300">
                    <span className="font-medium text-white">
                      {activity.action}
                    </span>{' '}
                    - {activity.item}
                  </p>
                  <p className="text-xs text-slate-500">
                    {activity.user} • {activity.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
