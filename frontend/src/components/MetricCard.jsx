function MetricCard({ title, value, subtitle, color = 'purple' }) {
  const colorClasses = {
    purple: 'bg-purple-500',
    teal: 'bg-teal-500',
    red: 'bg-red-500',
    green: 'bg-green-500',
    orange: 'bg-orange-500',
    blue: 'bg-blue-500',
  };

  return (
    <div className="relative rounded-lg overflow-hidden shadow-md">
      <div className={`${colorClasses[color]} h-2`}></div>
      <div className="bg-pink-50 p-4 min-h-[120px] flex flex-col justify-between">
        <h3 className="text-sm font-medium text-gray-700 mb-2">{title}</h3>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {subtitle && (
          <p className="text-xs text-gray-600 mt-2">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

export default MetricCard;

