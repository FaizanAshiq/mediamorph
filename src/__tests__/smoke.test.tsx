import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ConvertContext, createConvertStore } from '@/features/convert';
import { fakeEngine } from '@/features/convert/__tests__/support/fakes';
import { ConvertPage } from '@/pages/ConvertPage';

it('opens on the drop area, then shows the file once one is opened', async () => {
  const store = createConvertStore(fakeEngine().engine);
  const page = () => (
    <ConvertContext.Provider value={store}>
      <ConvertPage dragging={false} onOpen={() => {}} />
    </ConvertContext.Provider>
  );
  const { rerender } = render(page());
  expect(screen.getByText('Drop a video here')).toBeInTheDocument();

  await store.getState().open(['/m/Night Train.mkv']);
  rerender(page());
  expect(screen.getByRole('heading', { name: 'Night Train.mkv' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Result' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Convert' })).toBeInTheDocument();
});
