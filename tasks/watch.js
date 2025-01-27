import gulp from 'gulp';

// Ensure referenced tasks are imported.
import './server.js';


gulp.task('watch', gulp.series('build', 'server', () => {
  gulp.watch('assets/css/**/*.css',
      gulp.series('css', 'content', 'sw'));
  gulp.watch('assets/images/**/*',
      gulp.series('images', 'content'));
  gulp.watch('assets/javascript/**/*.js',
      gulp.series('javascript', 'content', 'sw'));
  gulp.watch(['book.yaml', 'templates/**/*', 'articles/*.md'],
      gulp.series('content', 'sw'));
  gulp.watch('assets/sw/**/*.js',
      gulp.series('sw'));
  gulp.watch('package.json',
      gulp.series('sw'));
}));
