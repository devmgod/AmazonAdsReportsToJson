import { useState } from 'react';

function Navigation({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'home', label: 'Home', icon: '📊' },
    { id: 'gestaoAds', label: 'GestãoAds', icon: '⚙️' },
    { id: 'estoqueVendas', label: 'Sales and Inventory', icon: '🚀' },
  ];

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                px-6 py-3 text-sm font-medium transition-colors duration-200
                border-b-2 relative
                ${
                  activeTab === tab.id
                    ? 'text-green-600 border-green-600'
                    : 'text-orange-600 border-transparent hover:text-orange-700 hover:border-orange-300'
                }
              `}
            >
              <div className="flex items-center gap-2">
                {tab.icon && <span>{tab.icon}</span>}
                <span>{tab.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

export default Navigation;

