import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConvertPage } from '@/pages/ConvertPage';
import { SetupScreen } from '../components/SetupScreen';
import { UpdateNote } from '../components/UpdateNote';
import { ConvertContext, createConvertStore, type ConvertOptions } from '../store';
import { fakeEngine } from './support/fakes';
import { blueHarbourInfo, nightTrainInfo, makeInfo } from './support/fixtures';

const quick = { estimateDelayMs: 0 };

async function open(infoOf: typeof nightTrainInfo = nightTrainInfo, options: ConvertOptions = quick, fake = fakeEngine()) {
  fake.engine.probe = async (path) => {
    if (path.endsWith('.txt')) throw new Error('Invalid data found when processing input');
    return infoOf(path);
  };
  const store = createConvertStore(fake.engine, options);
  const onOpen = vi.fn();
  render(
    <ConvertContext.Provider value={store}>
      <ConvertPage dragging={false} onOpen={onOpen} />
    </ConvertContext.Provider>,
  );
  await act(() => store.getState().open(['/m/Night Train.mkv']));
  return { store, onOpen, fake };
}
const result = () => screen.getByRole('region', { name: 'Result' });
const happens = () => screen.getByRole('region', { name: 'What will happen' });

describe('the empty window', () => {
  it('invites a drop and opens the file picker', async () => {
    const store = createConvertStore(fakeEngine().engine, quick);
    const onOpen = vi.fn();
    render(
      <ConvertContext.Provider value={store}>
        <ConvertPage dragging={false} onOpen={onOpen} />
      </ConvertContext.Provider>,
    );
    expect(screen.getByRole('heading', { name: 'Drop a video here' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convert' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose a file' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('says only one file was opened when several are dropped', async () => {
    const { store } = await open();
    await act(() => store.getState().open(['/m/a.mkv', '/m/b.mkv']));
    expect(screen.getByText('Mediamorph converts one file at a time, so only a.mkv was opened.')).toBeInTheDocument();
  });
});

describe('the result card', () => {
  it('sets the size now against the size after, exact once the packets are scanned', async () => {
    await open();
    expect(await within(result()).findByText('980 MB')).toBeInTheDocument();
    expect(within(result()).getByText('101% of the original')).toBeInTheDocument();
    expect(within(result()).getByText('About the same size')).toBeInTheDocument();
    expect(within(result()).getByText('968 MB · 732 kbps video')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Quality' })).toHaveAttribute('aria-valuetext', 'No quality loss');
  });

  it('compares now and after on one scale, each with its size and video bitrate', async () => {
    await open();
    await userEvent.selectOptions(screen.getByLabelText('Size'), '480');
    const rows = await screen.findByRole('list', { name: 'Size and bitrate' });
    await within(rows).findByText(/^about [\d.]+ MB · 640 kbps video$/);
    expect(within(rows).getByText('Now')).toBeInTheDocument();
    expect(within(rows).getByText('968 MB · 732 kbps video')).toBeInTheDocument();
    expect(within(rows).getByText('After')).toBeInTheDocument();
  });

  it('moves the after bitrate as the slider moves', async () => {
    await open();
    await userEvent.selectOptions(screen.getByLabelText('Size'), '480');
    const rows = await screen.findByRole('list', { name: 'Size and bitrate' });
    await within(rows).findByText(/· 640 kbps video$/);
    fireEvent.change(screen.getByRole('slider', { name: 'Quality' }), { target: { value: '70' } });
    expect(within(rows).getByText(/^roughly [\d.]+ MB · 320 kbps video$/)).toBeInTheDocument();
  });

  it('never cuts the big figure: it wraps with a normal line height, and is not truncated', async () => {
    await open();
    const figure = await within(result()).findByText('980 MB');
    expect(figure).toHaveClass('leading-tight');
    expect(figure).not.toHaveClass('truncate');
    expect(figure).not.toHaveClass('leading-none');
  });

  it('greys out sizes that are not smaller than the original', async () => {
    await open();
    const size = screen.getByLabelText('Size');
    expect(within(size).getByRole('option', { name: '1080p (not smaller than the original)' })).toBeDisabled();
    expect(within(size).getByRole('option', { name: '480p (854x352)' })).toBeEnabled();
  });

  it('offers sizes for a portrait phone video by its on-screen shape', async () => {
    await open((path) => makeInfo({ path, video: { index: 0, codec: 'hevc', width: 1920, height: 1080, fps: 30, bitDepth: 8, hdr: 'sdr', rotation: 90 } }));
    const size = screen.getByLabelText('Size');
    expect(within(size).getByRole('option', { name: 'Original (1080x1920)' })).toBeEnabled();
    expect(within(size).getByRole('option', { name: '720p (720x1280)' })).toBeEnabled();
    expect(screen.getByText(/^HEVC 1080x1920 /)).toBeInTheDocument();
  });

  it('trades quality for size on the slider, and the plain words follow', async () => {
    const { store } = await open();
    await within(result()).findByText('980 MB');
    const slider = screen.getByRole('slider', { name: 'Quality' });
    fireEvent.change(slider, { target: { value: '60' } });
    expect(store.getState().file?.settings.video.rate).toEqual({ mode: 'quality', quality: 60 });
    expect(slider).toHaveAttribute('aria-valuetext', 'Slight softening');
    expect(within(result()).getByText(/^Roughly \d/)).toBeInTheDocument();
    expect(within(happens()).getByText('Video: re-encoded as HEVC, slight softening')).toBeInTheDocument();
  });

  it('picks a speed, saying what the smallest file costs', async () => {
    const { store } = await open();
    await userEvent.selectOptions(screen.getByLabelText('Size'), '480');
    await userEvent.click(screen.getByRole('radio', { name: 'Smallest file' }));
    expect(store.getState().file?.settings.video.speed).toBe('smallest');
    expect(screen.getByRole('radio', { name: 'Smallest file' })).toBeChecked();
    expect(screen.getByText('About 20 percent smaller at the same look; takes about 2.7 times as long.')).toBeInTheDocument();
  });

  it('restyles the speed pills when the settings change from code, not only from a click', async () => {
    const { store } = await open();
    const pill = (name: string) => screen.getByRole('radio', { name }).nextElementSibling!;
    expect(pill('Balanced')).toHaveClass('opacity-40');
    fireEvent.change(screen.getByRole('slider', { name: 'Quality' }), { target: { value: '60' } });
    expect(pill('Balanced')).toHaveClass('bg-accent');
    expect(pill('Balanced')).not.toHaveClass('opacity-40');
    act(() => store.getState().setSettings({ ...store.getState().file!.settings, video: { ...store.getState().file!.settings.video, speed: 'smallest' } }));
    expect(pill('Smallest file')).toHaveClass('bg-accent');
    expect(pill('Balanced')).not.toHaveClass('bg-accent');
  });

  it('greys out Fast without a hardware encoder', async () => {
    await open(nightTrainInfo, { ...quick, machine: { filters: new Set(), encoders: new Set(['libx264', 'libx265']) } });
    await userEvent.selectOptions(screen.getByLabelText('Size'), '480');
    expect(screen.getByRole('radio', { name: 'Fast' })).toBeDisabled();
  });

  it('greys out size, quality and speed for audio only', async () => {
    await open();
    await userEvent.selectOptions(screen.getByLabelText('Format'), 'm4a');
    expect(screen.getByLabelText('Size')).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Quality' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Balanced' })).toBeDisabled();
  });
});

describe('the settings tabs', () => {
  it('unticks an audio track, and plays another first with one click', async () => {
    const { store } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Play English first' }));
    expect(store.getState().file?.settings.audio.first).toBe(2);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hindi · AAC 5.1' }));
    expect(within(happens()).getByText('Audio: English 5.1 copied')).toBeInTheDocument();
    expect(screen.queryByText('Plays first')).not.toBeInTheDocument();
  });

  it('greys out image subtitles MP4 cannot hold, and burning names the track', async () => {
    await open(blueHarbourInfo);
    expect(screen.getAllByRole('checkbox', { name: 'English · image (burn in or choose MKV)' })[0]).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Burn into the picture (re-encodes the video)' }));
    expect(screen.getByLabelText('Which subtitles')).toBeInTheDocument();
  });

  it('sets a target size in Picture, which hands the size over from the slider', async () => {
    const { store } = await open();
    await userEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    await userEvent.selectOptions(screen.getByLabelText('Size decided by'), 'target');
    expect(store.getState().file?.settings.video.rate).toEqual({ mode: 'target', bytes: 2e9 });
    expect(screen.getByLabelText('Target size in GB')).toHaveValue(2);
    expect(screen.getByRole('slider', { name: 'Quality' })).toBeDisabled();
    expect(screen.getByText('Set in Picture')).toBeInTheDocument();
  });

  it('starts a fixed bitrate from the bitrate the slider was heading for', async () => {
    const { store } = await open();
    await userEvent.selectOptions(screen.getByLabelText('Size'), '480');
    await within(await screen.findByRole('list', { name: 'Size and bitrate' })).findByText(/^about .* · 640 kbps video$/);
    await userEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    await userEvent.selectOptions(screen.getByLabelText('Size decided by'), 'bitrate');
    expect(store.getState().file?.settings.video.rate).toEqual({ mode: 'bitrate', kbps: 640 });
    expect(screen.getByLabelText('Bitrate in kbps')).toHaveValue(640);
  });

  it('sets loudness and saves a preset in Advanced', async () => {
    const { store, fake } = await open();
    await userEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    await userEvent.selectOptions(screen.getByLabelText('Loudness'), 'eu-tv');
    expect(within(happens()).getByText(/set to -23 LUFS for EU TV/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Save these settings as a preset'), 'EU delivery');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(fake.saved[0].map((p) => p.name)).toEqual(['EU delivery']);
    expect(store.getState().file?.presetName).toBe('EU delivery');
  });

  it('applies a preset from the header', async () => {
    const { store } = await open();
    await userEvent.selectOptions(screen.getByLabelText('Preset'), '720p for phones');
    expect(store.getState().file?.settings.size).toBe(720);
  });

  it('ticks moving the original to the Trash', async () => {
    const { store } = await open();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Move the original to the Trash when done' }));
    expect(store.getState().file?.settings.trashOriginal).toBe(true);
  });

  it('plays 10 s of the original and of these settings together, with one Play and Pause for both', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:clip');
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    await open();
    await userEvent.selectOptions(screen.getByLabelText('Size'), '480');
    await userEvent.click(screen.getByRole('button', { name: 'Preview 10 s' }));
    const dialog = await screen.findByRole('dialog', { name: 'Preview 10 s' });
    const original = await within(dialog).findByLabelText('Original, 10 seconds');
    const after = within(dialog).getByLabelText('These settings, 10 seconds');
    expect([original.tagName, after.tagName]).toEqual(['VIDEO', 'VIDEO']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    expect(pause).toHaveBeenCalledTimes(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalledTimes(2);
    expect(within(dialog).getByRole('slider', { name: 'Move the comparison line' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    play.mockRestore();
    pause.mockRestore();
  });
});

describe('converting and done', () => {
  it('shows progress and Stop while converting, with the settings locked away', async () => {
    const { store } = await open(nightTrainInfo, quick, fakeEngine({ holdRuns: true }));
    let converting: Promise<void> = Promise.resolve();
    act(() => {
      converting = store.getState().convert();
    });
    expect(await screen.findByRole('progressbar', { name: 'Converting' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByRole('tab', { name: 'Tracks' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(() => converting);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows the finished size, what else was saved, and offers to convert again', async () => {
    const fake = fakeEngine({ doneWith: { extras: ['/m/Night Train.eng.srt'], warnings: ['The original could not be moved to the Trash.'] } });
    const { store } = await open(nightTrainInfo, quick, fake);
    await act(() => store.getState().convert());
    expect(within(result()).getByText('Done')).toBeInTheDocument();
    const rows = screen.getByRole('list', { name: 'Size and bitrate' });
    expect(within(rows).getByText('Before')).toBeInTheDocument();
    expect(within(rows).queryByText('Now')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show in Finder' })).toBeInTheDocument();
    expect(screen.getByText('Also saved: Night Train.eng.srt')).toBeInTheDocument();
    expect(screen.getByText('The original could not be moved to the Trash.')).toBeInTheDocument();
    // Done, the plan is what happened; ready again, it is what will.
    expect(screen.getByRole('region', { name: 'What happened' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Convert again with other settings' }));
    expect(store.getState().file?.status).toBe('ready');
    expect(happens()).toBeInTheDocument();
  });

  it('explains a failure in plain words and keeps the raw message behind Show details', async () => {
    const { store } = await open();
    await act(() => store.getState().open(['/m/notes.txt']));
    expect(screen.getByRole('alert')).toHaveTextContent('This is not a video or audio file Mediamorph can read.');
    await userEvent.click(screen.getByText('Show details'));
    expect(screen.getByText('Invalid data found when processing input')).toBeVisible();
  });

  it('tells screen readers when the file changes state', async () => {
    const { store } = await open();
    await act(() => store.getState().convert());
    expect(screen.getByText('Done · 968 MB → 968 MB')).toBeInTheDocument();
  });
});

describe('the title bar', () => {
  it('switches between light, dark and the system, and remembers it', async () => {
    await open();
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(localStorage.getItem('mediamorph.appearance')).toBe('dark');
    await userEvent.click(screen.getByRole('radio', { name: 'Match the system' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('converts with the one orange button', async () => {
    const { store, onOpen } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Open another' }));
    expect(onOpen).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Convert' }));
    expect(store.getState().file?.status).toBe('done');
  });
});

describe('SetupScreen', () => {
  it('says to download Mediamorph again, and checks again', async () => {
    const onCheckAgain = vi.fn();
    render(<SetupScreen onCheckAgain={onCheckAgain} />);
    expect(screen.getByRole('heading', { name: 'Mediamorph could not start ffmpeg' })).toBeInTheDocument();
    expect(screen.queryByText(/brew install/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onCheckAgain).toHaveBeenCalledOnce();
  });
});

describe('UpdateNote', () => {
  it('says what Mediamorph was updated to, then goes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<UpdateNote read={async () => '1.0.1'} seconds={6} />);
    expect(await screen.findByText('Updated to Mediamorph 1.0.1')).toBeInTheDocument();
    await act(async () => void vi.advanceTimersByTime(6000));
    expect(screen.queryByText(/Updated to/)).toBeNull();
    vi.useRealTimers();
  });

  it('says nothing after a start that was not an update', async () => {
    render(<UpdateNote read={async () => null} />);
    await act(async () => {});
    expect(screen.queryByText(/Updated to/)).toBeNull();
  });
});
