function ApiStatusCards({ tokenStatus, campaignsCount, ordersCount, campaignsError, ordersError }) {
  // Determine LWA Token status
  const lwaTokenStatus = tokenStatus?.amazonLwaToken?.hasAccessToken ? 'success' : 'error';
  const lwaTokenMessage = tokenStatus?.amazonLwaToken?.hasAccessToken 
    ? 'Token SP-API obtido' 
    : 'Token não disponível';

  // Helper function to truncate long error messages
  const truncateMessage = (message, maxLength = 50) => {
    if (!message) return '';
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  };

  // Determine Ads API status
  const adsApiStatus = !campaignsError && campaignsCount !== null && campaignsCount !== undefined ? 'success' : 'error';
  const adsApiMessage = campaignsError 
    ? `Erro: ${truncateMessage(campaignsError)}` 
    : `${campaignsCount || 0} campanhas`;

  // Determine SP-API status
  const spApiStatus = !ordersError && ordersCount !== null && ordersCount !== undefined ? 'success' : 'error';
  const spApiMessage = ordersError 
    ? `Erro: ${truncateMessage(ordersError)}` 
    : `${ordersCount || 0} pedidos`;

  const statusCards = [
    {
      title: 'LWA Token',
      status: lwaTokenStatus,
      message: lwaTokenMessage,
      icon: lwaTokenStatus === 'success' ? '✓' : '✗',
    },
    {
      title: 'Ads API',
      status: adsApiStatus,
      message: adsApiMessage,
      icon: adsApiStatus === 'success' ? '✓' : '✗',
    },
    {
      title: 'SP-API',
      status: spApiStatus,
      message: spApiMessage,
      icon: spApiStatus === 'success' ? '✓' : '✗',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {statusCards.map((card, index) => (
        <div
          key={index}
          className={`rounded-lg p-4 flex items-center justify-between shadow-sm border ${
            card.status === 'success'
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}
        >
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-800">{card.title}</h3>
            <p className={`text-xs mt-1 ${
              card.status === 'success' ? 'text-gray-600' : 'text-red-700'
            }`}>
              {card.message}
            </p>
          </div>
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ml-3 ${
              card.status === 'success'
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
            }`}
          >
            <span className="text-lg font-bold">{card.icon}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default ApiStatusCards;

