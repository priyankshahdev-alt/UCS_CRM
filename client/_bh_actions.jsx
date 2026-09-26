import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SimProvider, useSim } from '/src/panels/accounts/sim/store';
import Inventory from '/src/panels/accounts/sim/Inventory';
import '/src/panels/accounts/sim/simScope.css';

function Inner() {
  const { refresh } = useSim();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    refresh();
  }, [refresh]);
  return (
    <Inventory
      onAdd={() => {}}
      onView={() => {}}
      onEdit={() => {}}
      onReplace={() => {}}
      onDelete={() => {}}
      onHistory={() => {}}
      simName="Android"
    />
  );
}

// Mirrors App.jsx (`.panel-accounts` wrapper) > SimSection (`.sim-scope`).
// They must be nested, not on one element, or the scoped CSS never matches.
createRoot(document.getElementById('root')).render(
  <div className="panel-accounts">
    <div className="sim-scope">
      <div className="card-block">
        <SimProvider>
          <Inner />
        </SimProvider>
      </div>
    </div>
  </div>,
);
