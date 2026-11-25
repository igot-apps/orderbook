import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dialog } from './ui';

function EditableDialog() {
  const [value, setValue] = useState('');
  return (
    <Dialog open onClose={() => {}} title="Invoice">
      <input aria-label="Reason for change" value={value} onChange={(event) => setValue(event.target.value)} />
    </Dialog>
  );
}

describe('Dialog focus', () => {
  it('keeps focus in an input while its value rerenders the dialog', async () => {
    const user = userEvent.setup();
    render(<EditableDialog />);
    const reason = screen.getByRole('textbox', { name: 'Reason for change' });
    await user.click(reason);
    await user.type(reason, 'Larger fish');
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    expect(reason).toHaveValue('Larger fish');
    expect(reason).toHaveFocus();
  });
});
