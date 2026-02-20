import { useState, useEffect } from 'react';

interface Session {
  id: string;
  repo: string;
  status: string;
  startedAt: string;
  totalCost: number;
  directive: string;
}

interface SessionSelectorProps {
  currentSessionId: string;
}

export function SessionSelector({ currentSessionId }: SessionSelectorProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Fetch sessions list
    fetch('/api/sessions')
      .then(r => r.json())
      .then(data => setSessions(data))
      .catch(err => console.error('Failed to fetch sessions:', err));
  }, []);

  const handleSessionSwitch = (sessionId: string) => {
    if (sessionId === currentSessionId) {
      setIsOpen(false);
      return;
    }

    // Reload page with new session (dashboard will fetch new state)
    const url = new URL(window.location.href);
    url.searchParams.set('session', sessionId);
    window.location.href = url.toString();
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
      >
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        <span className="text-sm text-gray-300">
          {currentSession ? `${currentSession.repo} (${currentSession.status})` : 'Select Session'}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-96 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 max-h-96 overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="p-4 text-gray-500 text-center">No sessions available</div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSessionSwitch(session.id)}
                  className={`w-full text-left p-4 hover:bg-gray-700 transition-colors border-b border-gray-700 last:border-b-0 ${
                    session.id === currentSessionId ? 'bg-gray-700' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-white truncate">{session.repo}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          session.status === 'running' ? 'bg-cyan-900 text-cyan-300' :
                          session.status === 'completed' ? 'bg-green-900 text-green-300' :
                          session.status === 'failed' ? 'bg-red-900 text-red-300' :
                          'bg-gray-700 text-gray-300'
                        }`}>
                          {session.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 truncate mb-1">{session.directive}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>{new Date(session.startedAt).toLocaleDateString()}</span>
                        <span>${session.totalCost.toFixed(2)}</span>
                      </div>
                    </div>
                    {session.id === currentSessionId && (
                      <svg className="w-5 h-5 text-cyan-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
